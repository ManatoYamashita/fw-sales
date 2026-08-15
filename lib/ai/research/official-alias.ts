/**
 * known official URL と Google Search 候補の alias 統合
 * (feat/ai-research-quality-ux-hardening、Plan §8.2 / 承認レビュー指摘2)。
 *
 * ## 何を解決するか(Q5)
 *
 * 実機で、公式サイトの本文を読めているのに `concept` が `hearing_required` へ降格した。
 * 原因は **同一ページが Source Registry 上で2エントリに分裂**していたこと:
 *
 * - S01: `known_store_data` / `official_site` / `stores.site_url` そのもの
 *        → `deriveTrustedSourceType` が `official_site` を返す(**一次情報性あり**)が
 *          `url_context_status` は `not_attempted`(本文未取得)
 * - S02: `gemini_search_candidate` / grounding redirect URL
 *        → `url_context_status: "success"`(本文取得済み)だが hostname が
 *          `vertexaisearch.cloud.google.com` のため `deriveTrustedSourceType` は
 *          `undefined`(**一次情報性なし**)
 *
 * `validateResearchItemStatus` の path2 は両方を**1エントリに**要求するため、
 * 2つ合わせれば条件を満たしているのにどちらも単独では満たさない。
 *
 * ## 解決方法(trust boundary を緩めない)
 *
 * Stage2 の**前**に、候補 URL のリダイレクト先をサーバー側で辿り、
 * known official URL と**同一ページであることをコード側で決定的に確認できた場合のみ**
 * 候補エントリを破棄して known_store_data エントリへ統合する。
 * その結果 Gemini は S01 を直接取得・引用でき、path2 の3条件が1エントリで揃う。
 *
 * **使う情報はアプリDBの `stores.site_url` とサーバー側 HEAD が辿った最終URLだけ。**
 * モデルの `source_type` / `title` / `relation` 自己申告は一切使わない。
 * `PRIMARY_SOURCE_TYPES` / `deriveTrustedSourceType` も無改変。
 *
 * ## 統合条件(すべて AND。ひとつでも欠ければ安全側 fallback)
 *
 * 1. resolver が `resolved` を返した
 * 2. **final HTTP status が 2xx** — resolver は元々表示・監査用で、最終ページが
 *    4xx/5xx でも `resolved` を返す。trust 判定へ昇格させるには不十分なため追加要求する
 * 3. safe normalization(`url-normalize.ts`。`www.` 除去・origin-only match をしない)
 * 4. known official URL と**厳格一致**(scheme + host + port + path + query)
 *
 * false positive よりも false negative を優先する。統合できなければ
 * `concept` は従来どおり `hearing_required` のままであり、これは**退化ではなく現状維持**。
 *
 * ## コスト
 *
 * HEAD リクエストのみ(body を読まない)。Gemini 呼び出しは増えない。
 * known official URL が 0 件の店舗では resolver を1回も呼ばない。
 */

import "server-only";

import { isAllowedStartHost, resolveGroundingRedirectUrl } from "./source-url-resolver";
import { isStrictSameUrl, normalizeUrlForMatch } from "./url-normalize";
import { reindexSourceRegistry } from "./source-registry";
import type { SourceRegistryEntry } from "@/lib/ai/research-result-schema";

/**
 * resolve を試みる候補エントリの上限。
 * resolver は 1 URL あたり最大 5s(`TOTAL_TIMEOUT_MS`)なので、並列実行でも
 * 想定 5〜8s に収まるよう件数を抑える。`persistSourceRegistryStep` の
 * `DB_STEP_BUDGET_MS = 15_000` 見積内に収めるための上限。
 */
export const ALIAS_RESOLVE_MAX_ENTRIES = 8;

export interface ResolveOfficialAliasesParams {
  registry: readonly SourceRegistryEntry[];
  /** `stores.site_url` / `stores.instagram_url`(空文字は呼び出し側で除外済み)。 */
  knownOfficialUrls: readonly string[];
  maxEntries?: number;
}

export interface ResolveOfficialAliasesResult {
  registry: SourceRegistryEntry[];
  /** 統合(破棄)した候補エントリ数。structured log 用。 */
  merged: number;
  /** resolve を試みた候補エントリ数。structured log 用。 */
  attempted: number;
  /** 起点ホストが許可外で resolve 対象にしなかった候補数。 */
  skippedUnsupportedHost: number;
  /**
   * 統合に至らなかった理由ごとの件数(**sanitized token のみ**)。
   *
   * 実機では `attempted: 8 / merged: 0` しか残らず、timeout / DNS / IP 拒否の
   * どれなのか切り分けられなかった。URL・redirect token・provider response 本文・
   * 生エラーメッセージは**一切含めない**(allowlist 外は `request_error` に丸める)。
   */
  failures: Record<string, number>;
}

/**
 * `resolveGroundingRedirectUrl` が返す **静的な** reason の allowlist。
 * ここに無い文字列(ネットワークエラーの生メッセージ等。IP やホスト名を含みうる)は
 * `request_error` へ丸めてからでないとログへ出さない。
 */
const KNOWN_RESOLVE_FAILURE_REASONS: ReadonlySet<string> = new Set([
  "invalid_url",
  "disallowed_start_host",
  "non_https_scheme",
  "credentials_in_url",
  "dns_lookup_failed",
  "dns_no_records",
  // SSRF 判定を lib/security/url-safety.ts へ一本化した際に増えた reason。
  // 旧実装の dns.promises.lookup には timeout が無く、全体 timeout を超えて
  // 待ち続けうる穴があった (その場合は timeout / request_error として現れていた)。
  "dns_timeout",
  "disallowed_ip_range",
  "timeout",
  "invalid_redirect_location",
  "too_many_redirects",
  "hop_timeout",
]);

function sanitizeResolveFailureReason(reason: unknown): string {
  return typeof reason === "string" && KNOWN_RESOLVE_FAILURE_REASONS.has(reason)
    ? reason
    : "request_error";
}

/**
 * 候補エントリのリダイレクト先を解決し、known official URL と厳格一致するものを
 * known_store_data エントリへ統合する。
 *
 * **best-effort。** resolver が全滅しても registry はそのまま Stage2 へ進む
 * (run を失敗させない)。
 */
export async function resolveOfficialAliases(
  params: ResolveOfficialAliasesParams,
): Promise<ResolveOfficialAliasesResult> {
  const { registry, knownOfficialUrls, maxEntries = ALIAS_RESOLVE_MAX_ENTRIES } = params;
  const empty = (skippedUnsupportedHost = 0): ResolveOfficialAliasesResult => ({
    registry: [...registry],
    merged: 0,
    attempted: 0,
    skippedUnsupportedHost,
    failures: {},
  });

  // known official URL が無い店舗では統合の余地が無い。無駄な HEAD を出さない。
  const normalizedKnown = knownOfficialUrls
    .map((url) => normalizeUrlForMatch(url))
    .filter((url): url is string => url !== null);
  if (normalizedKnown.length === 0) return empty();

  // 統合先(known_store_data エントリ)が存在する URL だけを対象にする。
  const mergeTargets = new Set(
    registry
      .filter((entry) => entry.discovery_provenance === "known_store_data")
      .map((entry) => normalizeUrlForMatch(entry.grounding_redirect_url))
      .filter((url): url is string => url !== null && normalizedKnown.includes(url)),
  );
  if (mergeTargets.size === 0) return empty();

  // 起点ホストが許可外の候補は `resolveGroundingRedirectUrl` が
  // ネットワークに出る前に `disallowed_start_host` で必ず失敗する。
  // モデルの `[SOURCE]` は実サイトURL(食べログ等)を書いてくることもあるため、
  // これらを attempt に含めると **maxEntries の枠を食い潰して本命の redirect が
  // 試行されない**。resolve 対象から先に除外する(registry からは落とさない)。
  const geminiCandidates = registry.filter(
    (entry) => entry.discovery_provenance === "gemini_search_candidate",
  );
  const resolvable = geminiCandidates.filter((entry) => {
    const host = hostnameOfCandidate(entry.grounding_redirect_url);
    return host !== null && isAllowedStartHost(host);
  });
  const skippedUnsupportedHost = geminiCandidates.length - resolvable.length;

  const candidates = resolvable.slice(0, maxEntries);
  if (candidates.length === 0) return empty(skippedUnsupportedHost);

  const settled = await Promise.allSettled(
    candidates.map((entry) => resolveGroundingRedirectUrl(entry.grounding_redirect_url)),
  );

  /** grounding_redirect_url → 解決結果。 */
  const outcomeByUrl = new Map<string, { resolvedUrl: string | null; isAlias: boolean }>();
  const failures: Record<string, number> = {};
  const countFailure = (reason: string): void => {
    failures[reason] = (failures[reason] ?? 0) + 1;
  };

  candidates.forEach((entry, index) => {
    const settledResult = settled[index];
    if (settledResult === undefined || settledResult.status === "rejected") {
      // 生の例外メッセージはログへ出さない(IP・ホスト名を含みうる)。
      countFailure("rejected");
      outcomeByUrl.set(entry.grounding_redirect_url, { resolvedUrl: null, isAlias: false });
      return;
    }
    const outcome = settledResult.value;
    if (outcome.status !== "resolved") {
      countFailure(sanitizeResolveFailureReason(outcome.reason));
      outcomeByUrl.set(entry.grounding_redirect_url, { resolvedUrl: null, isAlias: false });
      return;
    }
    // 条件2: final HTTP status が 2xx でなければ trust の根拠にしない。
    // (resolved_url 自体は表示・監査用として記録してよい)
    const isSuccessStatus = outcome.finalStatus >= 200 && outcome.finalStatus < 300;
    // 条件3+4: safe normalization を通した**厳格一致**のみ alias とみなす。
    const isAlias =
      isSuccessStatus &&
      knownOfficialUrls.some((knownUrl) => {
        if (!isStrictSameUrl(outcome.url, knownUrl)) return false;
        const normalized = normalizeUrlForMatch(knownUrl);
        return normalized !== null && mergeTargets.has(normalized);
      });
    if (!isSuccessStatus) countFailure("non_2xx_final");
    else if (!isAlias) countFailure("no_strict_match");
    outcomeByUrl.set(entry.grounding_redirect_url, { resolvedUrl: outcome.url, isAlias });
  });

  let mergedCount = 0;
  const next: SourceRegistryEntry[] = [];
  for (const entry of registry) {
    const outcome = outcomeByUrl.get(entry.grounding_redirect_url);
    if (outcome === undefined) {
      next.push(entry);
      continue;
    }
    if (outcome.isAlias) {
      // known_store_data エントリと同一ページであることが確認できたので破棄する。
      // 統合先(S01)は provenance / source_type / URL をそのまま維持するため、
      // `deriveTrustedSourceType` は引き続き official_site を返す。
      mergedCount += 1;
      continue;
    }
    next.push({
      ...entry,
      resolved_url: outcome.resolvedUrl,
      resolve_status: outcome.resolvedUrl === null ? "failed" : "resolved",
    });
  }

  return {
    // Stage2 プロンプトへ渡す前なので、id を詰め直してよい(モデルはまだ参照していない)。
    registry: mergedCount > 0 ? reindexSourceRegistry(next) : next,
    merged: mergedCount,
    attempted: candidates.length,
    skippedUnsupportedHost,
    failures,
  };
}

/** URL の hostname を取り出す(解釈できなければ `null`)。 */
function hostnameOfCandidate(rawUrl: string): string | null {
  try {
    return new URL(rawUrl).hostname;
  } catch {
    return null;
  }
}
