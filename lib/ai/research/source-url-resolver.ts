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
 * 関連: Plan v3.2 §11「Stage 1.5: redirect URL resolver設計」
 */

import "server-only";

import * as https from "node:https";
import * as dns from "node:dns";
import type { LookupFunction } from "node:net";
import { isIP } from "node:net";

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
    const safety = await validateHopSafety(current);
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
 * 1 hop 分の安全性を検証する: スキーム・credentials・DNS解決結果のIPレンジ。
 * 検証に使った実IPを `pinnedLookup` として返し、実際の接続もこのIPへ固定する
 * (DNS rebinding対策)。
 */
async function validateHopSafety(url: URL): Promise<HopSafetyOk | HopSafetyNg> {
  if (url.protocol !== "https:") {
    return { ok: false, reason: "non_https_scheme" };
  }
  if (url.username !== "" || url.password !== "") {
    return { ok: false, reason: "credentials_in_url" };
  }

  const hostname = url.hostname;

  // hostname自体がリテラルIPの場合(例: https://169.254.169.254/)は直接検証する。
  const literalIpVersion = isIP(hostname);
  const candidateAddresses: { address: string; family: 4 | 6 }[] = [];

  if (literalIpVersion !== 0) {
    candidateAddresses.push({
      address: hostname,
      family: literalIpVersion as 4 | 6,
    });
  } else {
    let lookupResult: dns.LookupAddress[];
    try {
      lookupResult = await dns.promises.lookup(hostname, { all: true, verbatim: true });
    } catch {
      return { ok: false, reason: "dns_lookup_failed" };
    }
    if (lookupResult.length === 0) {
      return { ok: false, reason: "dns_no_records" };
    }
    for (const r of lookupResult) {
      candidateAddresses.push({ address: r.address, family: r.family as 4 | 6 });
    }
  }

  for (const { address } of candidateAddresses) {
    if (isDisallowedAddress(address)) {
      return { ok: false, reason: "disallowed_ip_range" };
    }
  }

  // 検証済みの最初の実IPへ接続を固定する (dns rebinding対策)。
  const pinned = candidateAddresses[0]!;
  const pinnedLookup: LookupFunction = (_hostname, options, callback) => {
    if (typeof options === "function") {
      // Node の LookupFunction オーバーロードのうち options 省略形は本実装では使わない。
      (options as unknown as (err: NodeJS.ErrnoException | null, address: string, family: number) => void)(
        null,
        pinned.address,
        pinned.family,
      );
      return;
    }
    callback(null, pinned.address, pinned.family);
  };

  return { ok: true, pinnedLookup };
}

/**
 * private / loopback / link-local(cloud metadata endpoint含む)/ reserved を拒否する。
 * 網羅的な IANA レジストリ全件ではなく、SSRF 対策として重要な既知レンジを対象とする。
 */
/** テスト用に公開。SSRF対策の中核ロジックを直接検証するため。 */
export function isDisallowedAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) return isDisallowedIPv4(address);
  if (version === 6) return isDisallowedIPv6(address);
  return true; // 解釈できないアドレスは安全側で拒否
}

function isDisallowedIPv4(address: string): boolean {
  const octets = address.split(".").map((s) => Number.parseInt(s, 10));
  if (octets.length !== 4 || octets.some((n) => !Number.isFinite(n) || n < 0 || n > 255)) {
    return true; // 解釈できない = 拒否
  }
  const [a, b] = octets as [number, number, number, number];

  if (a === 0) return true; // 0.0.0.0/8
  if (a === 10) return true; // 10.0.0.0/8 private
  if (a === 127) return true; // 127.0.0.0/8 loopback
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local (metadata endpoint含む)
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12 private
  if (a === 192 && b === 168) return true; // 192.168.0.0/16 private
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
  if (a === 192 && b === 0) return true; // 192.0.0.0/24 IETF protocol assignments
  if (a === 198 && (b === 18 || b === 19)) return true; // 198.18.0.0/15 benchmarking
  if (a >= 224) return true; // 224.0.0.0/4 multicast, 240.0.0.0/4 reserved, 255.255.255.255 broadcast

  return false;
}

function isDisallowedIPv6(address: string): boolean {
  const normalized = address.toLowerCase();

  if (normalized === "::1") return true; // loopback
  if (normalized === "::") return true; // unspecified

  // IPv4-mapped (::ffff:a.b.c.d) は内包するIPv4として再検証する。
  const mappedMatch = normalized.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (mappedMatch) {
    return isDisallowedIPv4(mappedMatch[1]!);
  }

  if (normalized.startsWith("fe8") || normalized.startsWith("fe9") ||
      normalized.startsWith("fea") || normalized.startsWith("feb")) {
    return true; // fe80::/10 link-local
  }
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) {
    return true; // fc00::/7 unique local
  }
  if (normalized.startsWith("2001:db8")) {
    return true; // documentation range
  }
  if (normalized.startsWith("64:ff9b::")) {
    return true; // NAT64
  }

  return false;
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
