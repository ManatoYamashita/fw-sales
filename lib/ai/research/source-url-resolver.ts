/**
 * Stage 1.5: grounding redirect URL の安全な解決 (resolve)。
 * AI 店舗調査再設計(Plan v3.2 §11, PR2)。
 *
 * Google Search grounding の URL は `https://vertexaisearch.cloud.google.com/
 * grounding-api-redirect/...` 形式であり、サーバー側コードから直接ドメインを
 * 特定できない。本モジュールは表示・監査用に、この redirect URL を
 * **ベストエフォートかつ安全に**解決する。
 *
 * 重要: この解決は表示専用の付加情報であり、Stage2 の動作(URL Context に
 * `grounding_redirect_url` をそのまま渡す)には影響しない。解決に失敗しても
 * `grounding_redirect_url` はそのまま保持され、パイプラインは正常に継続する
 * (`resolve_status: "failed"`, `resolved_url: null`)。
 *
 * ## SSRF 対策(必須)
 *
 * - https のみ許可(スキームダウングレードも拒否)
 * - 解決対象は許可した Google grounding redirect host から始まる URL のみ
 *   (`isAllowedStartHost`)。任意の URL を解決する汎用ツールとしては使わない。
 * - credentials 付き URL (`user:pass@host`) を拒否
 * - redirect 回数上限(`MAX_REDIRECTS`)
 * - 各 hop で DNS 解決した実 IP を検証してから接続する(`dns.lookup` 結果を
 *   `https.request` の `lookup` オプションへ固定して渡すことで、検証後に別の
 *   IP へ再解決される DNS rebinding を防ぐ)
 * - loopback / link-local(169.254.169.254 等のクラウド metadata endpoint含む)/
 *   private IPv4 / private・reserved IPv6 を拒否
 * - リクエスト全体・hop 単位の timeout
 * - body は読まない(HEAD 相当、ヘッダ受信後に即座に破棄)
 *
 * ## IP レンジ判定と DNS pinning は `lib/security/url-safety.ts` に一本化している
 *
 * 本モジュールは当初 IP レンジ判定・pinned lookup を自前で持っていたが、PR #199 で
 * URL インポート側にも同等の実装が入り、**同じ判定が2つ存在する状態**になっていた。
 * 片方だけ直る事故を防ぐため、判定ロジックは `lib/security/url-safety.ts` へ寄せ、
 * 本モジュールは「起点ホストの限定」「redirect 追跡」「timeout 予算配分」という
 * このモジュール固有の責務だけを持つ。
 *
 * 統合によって以下が同時に改善している(いずれも url-safety 側が既に持っていたもの):
 *
 * - IPv6 をテキスト表記ではなく**数値展開**して判定するため、`::ffff:7f00:1` の
 *   ような 16 進表記の IPv4-mapped loopback を取りこぼさない(旧実装は
 *   `::ffff:d.d.d.d` の10進表記しか見ていなかった)
 * - `::127.0.0.1` 等の IPv4-compatible IPv6、multicast(`ff00::/8`)も拒否する
 * - 逆に IPv4 側は `192.0.0.0/16` を丸ごと拒否する**過剰拒否**を修正済み
 *   (`192.0.0.0/24` と `192.0.2.0/24` のみ拒否。WordPress.com/Gravatar 等の
 *   同レンジ内 global unicast を誤って弾かない)
 * - `createPinnedLookup` が `options.family` も尊重する
 * - DNS lookup 自体に timeout がかかる(旧実装は `dns.promises.lookup` に
 *   timeout が無く、TOTAL_TIMEOUT_MS を超えて待ち続けうる穴があった)
 *
 * 関連: Plan v3.2 §11「Stage 1.5: redirect URL resolver設計」, PR #199
 */

import "server-only";

import * as https from "node:https";
import type { LookupFunction } from "node:net";
import {
  createPinnedLookup,
  validateExternalUrl,
  type HostSafetyFailureReason,
} from "@/lib/security/url-safety";

/** 解決の起点として許可する host(完全一致)。 */
const ALLOWED_START_HOSTS = ["vertexaisearch.cloud.google.com"] as const;

/** 追跡するredirectの最大回数。 */
const MAX_REDIRECTS = 5;

/** 1 hop あたりのtimeout(ms)。 */
const PER_HOP_TIMEOUT_MS = 3000;

/** resolve全体のtimeout(ms)。 */
const TOTAL_TIMEOUT_MS = 5000;

export type ResolveOutcome =
  | {
      status: "resolved";
      url: string;
      /**
       * 最終ホップの HTTP status(feat/ai-research-quality-ux-hardening、承認レビュー指摘2)。
       *
       * 本 resolver は元々**表示・監査用**として設計されており、最終ページが 4xx/5xx でも
       * 「URLの実体を特定できた」として `resolved` を返す。この挙動は表示用途では正しいが、
       * **primary-source trust の根拠へ昇格させるには不十分**である
       * (存在しないページへの redirect でも `resolved` になってしまう)。
       *
       * trust-critical な呼び出し側(`resolveOfficialAliases`)は
       * `finalStatus` が 2xx であることを追加で要求する。既存の表示用途は
       * 本フィールドを無視すればよく、後方互換は保たれる。
       */
      finalStatus: number;
    }
  | { status: "failed"; reason: string };

/**
 * grounding redirect URL を安全に解決する。
 *
 * 起点URLが `ALLOWED_START_HOSTS` に含まれない場合は即座に失敗を返す
 * (このモジュールは汎用URL解決ツールではない)。
 */
export async function resolveGroundingRedirectUrl(
  startUrl: string,
): Promise<ResolveOutcome> {
  let parsed: URL;
  try {
    parsed = new URL(startUrl);
  } catch {
    return { status: "failed", reason: "invalid_url" };
  }

  if (!isAllowedStartHost(parsed.hostname)) {
    return { status: "failed", reason: "disallowed_start_host" };
  }

  const deadline = Date.now() + TOTAL_TIMEOUT_MS;
  let current = parsed;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    // DNS lookup も全体 timeout の予算内に収める。残余がゼロなら検証へ入らない。
    const remainingBeforeDns = deadline - Date.now();
    if (remainingBeforeDns <= 0) {
      return { status: "failed", reason: "timeout" };
    }

    const safety = await validateHopSafety(current, remainingBeforeDns);
    if (!safety.ok) {
      return { status: "failed", reason: safety.reason };
    }

    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      return { status: "failed", reason: "timeout" };
    }

    let result: HopResult;
    try {
      result = await requestOneHop(current, safety.pinnedLookup, Math.min(remaining, PER_HOP_TIMEOUT_MS));
    } catch (err) {
      return { status: "failed", reason: err instanceof Error ? err.message : "request_error" };
    }

    if (result.kind === "redirect") {
      let next: URL;
      try {
        next = new URL(result.location, current);
      } catch {
        return { status: "failed", reason: "invalid_redirect_location" };
      }
      current = next;
      continue;
    }

    // final: 2xx/4xx/5xx いずれもリクエスト自体は成功として、その時点のURLを解決結果とする。
    // (最終的に到達したページが404等でも、URLの実体を特定できたことに変わりはない)
    // trust 判定に使う呼び出し側は `finalStatus` の 2xx を追加で要求すること。
    return { status: "resolved", url: current.toString(), finalStatus: result.status };
  }

  return { status: "failed", reason: "too_many_redirects" };
}

/** テスト用に公開。判定ロジック自体を直接検証するため。 */
export function isAllowedStartHost(hostname: string): boolean {
  return (ALLOWED_START_HOSTS as readonly string[]).includes(hostname.toLowerCase());
}

interface HopSafetyOk {
  ok: true;
  pinnedLookup: LookupFunction;
}
interface HopSafetyNg {
  ok: false;
  reason: string;
}

/**
 * `validateExternalUrl` の失敗理由を、本モジュールが従来返していた reason 文字列へ写す。
 *
 * `official-alias.ts` の `KNOWN_RESOLVE_FAILURE_REASONS` が allowlist として
 * これらの token をそのまま持っており、過去 run のログとも突き合わせるため、
 * **統合を理由に token を変えない**。https 限定という本モジュール固有の制約は
 * `disallowed_scheme` ではなく従来どおり `non_https_scheme` と表現する。
 */
const HOP_FAILURE_REASON: Record<HostSafetyFailureReason, string> = {
  disallowed_scheme: "non_https_scheme",
  credentials_in_url: "credentials_in_url",
  dns_lookup_failed: "dns_lookup_failed",
  dns_no_records: "dns_no_records",
  dns_timeout: "dns_timeout",
  disallowed_ip_range: "disallowed_ip_range",
};

/**
 * 1 hop 分の安全性を検証する: スキーム・credentials・DNS解決結果のIPレンジ。
 * 検証に使った実IPを `pinnedLookup` として返し、実際の接続もこのIPへ固定する
 * (DNS rebinding対策)。
 *
 * 判定本体は `lib/security/url-safety.ts` に委譲する(モジュール先頭の JSDoc 参照)。
 * ここが持つのは「https のみ許可」という本モジュール固有の制約と、
 * 全体 timeout 予算から DNS 分を切り出す責務だけ。
 *
 * 検証済みアドレスは**全件**を pin する(先頭1件ではない)。全件が
 * `validateExternalUrl` の拒否レンジ検査を通過しており、全件渡すことで
 * Node の Happy Eyeballs がデュアルスタックホストで正しく機能する。
 */
async function validateHopSafety(
  url: URL,
  dnsTimeoutMs: number,
): Promise<HopSafetyOk | HopSafetyNg> {
  const safety = await validateExternalUrl(url, {
    allowedSchemes: ["https:"],
    dnsTimeoutMs,
  });

  if (!safety.ok) {
    return { ok: false, reason: HOP_FAILURE_REASON[safety.reason] };
  }

  return { ok: true, pinnedLookup: createPinnedLookup(safety.resolvedAddresses) };
}

type HopResult =
  | { kind: "redirect"; location: string }
  | { kind: "final"; status: number };

function requestOneHop(
  url: URL,
  lookup: LookupFunction,
  timeoutMs: number,
): Promise<HopResult> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        method: "HEAD",
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || 443,
        path: `${url.pathname}${url.search}`,
        lookup,
        timeout: timeoutMs,
        headers: {
          "User-Agent": "fw-sales-source-resolver/1.0 (+internal display-only link resolution)",
        },
      },
      (res) => {
        // headerだけ読んで即座に破棄する。bodyは不要。
        res.destroy();

        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400) {
          const location = res.headers.location;
          if (typeof location === "string" && location.length > 0) {
            resolve({ kind: "redirect", location });
            return;
          }
        }
        resolve({ kind: "final", status });
      },
    );

    req.on("timeout", () => {
      req.destroy(new Error("hop_timeout"));
    });
    req.on("error", (err) => {
      reject(err);
    });
    req.end();
  });
}
