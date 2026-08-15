/**
 * 外部URL/IPアドレスの安全性判定プリミティブ(fix/url-import-ssrf-hardening)。
 *
 * `lib/url-parser/ogp.ts`(URL Import機能)のSSRF対策として新設する。I/Oを持たない
 * 純粋関数(スキーム・credentials・IPレンジ判定)と、DNS解決を伴う`validateExternalUrl`
 * のみを提供する。実際のHTTPリクエスト送信は`lib/security/safe-http-fetch.ts`の責務。
 *
 * IPv4/IPv6の拒否レンジ判定ロジックは、feat/ai-research-foundation側の
 * `lib/ai/research/source-url-resolver.ts`(未マージのPR #180)と同種の設計思想を
 * 踏襲しつつ、実装前レビューで発見した2件の既知バグを最初から修正した状態で新設する:
 *
 * 1. IPv6 literalの角括弧ストリップ漏れ: `URL.hostname`はIPv6の場合`"[::1]"`のように
 *    角括弧付きで返るが、`net.isIP()`は角括弧付き文字列をIPとして認識しない。
 *    角括弧を除去してから判定する(`stripIPv6Brackets`)。
 * 2. IPv4-mapped IPv6の正規化形式不一致: `::ffff:127.0.0.1`という表記は、
 *    `new URL()`のIPv6シリアライザによって`::ffff:7f00:1`(hex-group形式)へ
 *    正規化される。文字列パターンの正規表現マッチではなく、IPv6アドレスを
 *    128bit数値(8グループ)へ展開したうえで数値的にプレフィックス判定することで、
 *    テキスト表記の違いに影響されない判定にする(`isDisallowedIPv6`)。
 *
 * IPv4の数値表記難読化(10進整数・16進・8進、例: `2130706433`/`0x7f000001`/`0177.0.0.1`)
 * については、`new URL()`のIPv4ホストパーサが解析時点で標準ドット10進表記へ
 * 正規化することを実機確認済み(`node -e`で検証済み)。したがって、呼び出し側が
 * 生の入力文字列ではなく必ず`new URL(...)`でパースした`URL`オブジェクトの
 * `hostname`を本モジュールへ渡す限り、この種の難読化は`new URL()`自身の
 * 正規化によって無害化される。本モジュールはこの前提(`URL`オブジェクトのみを
 * 受け取るAPI設計)を維持することで、数値表記難読化への追加対応を持たない。
 */

import "server-only";

import * as dns from "node:dns";
import { isIP } from "node:net";
import type { LookupFunction } from "node:net";

/** 既定で許可するURLスキーム。Website/OGP importの対象は任意の公開サイトのため、
 *  https限定にはせずhttp/https両方を許可する(2026年時点でも常時https化されていない
 *  中小飲食店公式サイトが一定数存在するため)。 */
export const DEFAULT_ALLOWED_SCHEMES = ["http:", "https:"] as const;

/** DNS解決のデフォルトtimeout(ms)。呼び出し側(safe-http-fetch.ts)は
 *  hopごとの残り時間予算に応じてこれより短い値を渡すことができる。 */
const DEFAULT_DNS_TIMEOUT_MS = 5000;

/** URLのスキームが許可リストに含まれるか判定する。`file:`/`ftp:`/`data:`/
 *  `javascript:`/`gopher:`等の非HTTP(S)スキームを拒否する。 */
export function isAllowedScheme(
  protocol: string,
  allowedSchemes: readonly string[] = DEFAULT_ALLOWED_SCHEMES,
): boolean {
  return allowedSchemes.includes(protocol);
}

/** `user:pass@host`形式のcredentials付きURLを検出する。 */
export function hasCredentials(url: URL): boolean {
  return url.username !== "" || url.password !== "";
}

/** IPv6 literal hostname(`"[::1]"`)から角括弧を除去する。角括弧が無ければそのまま返す。 */
export function stripIPv6Brackets(hostname: string): string {
  if (hostname.length >= 2 && hostname.startsWith("[") && hostname.endsWith("]")) {
    return hostname.slice(1, -1);
  }
  return hostname;
}

/**
 * IPv4アドレス文字列(`isIP`で4と判定済みのもの)がprivate/loopback/link-local/
 * reserved/multicast等の拒否レンジに該当するか判定する。
 *
 * 拒否レンジ: 0.0.0.0/8, 10.0.0.0/8, 100.64.0.0/10(CGNAT), 127.0.0.0/8(loopback),
 * 169.254.0.0/16(link-local、cloud metadataエンドポイント169.254.169.254を含む),
 * 172.16.0.0/12, 192.0.0.0/24(IETF protocol assignments),
 * 192.0.2.0/24(TEST-NET-1、ドキュメント用), 192.168.0.0/16,
 * 198.18.0.0/15(benchmarking), 224.0.0.0/4以上(multicast/reserved/broadcast)。
 *
 * 192.0.0.0系は第3オクテットまで見て判定する。`a === 192 && b === 0` だけで
 * 判定すると 192.0.0.0/16 全体を拒否してしまい、同レンジ内の通常のglobal unicast
 * (例: Automattic の 192.0.78.0/24 = WordPress.com、192.0.80.0/24 = Gravatar)で
 * ホストされた正規サイトのURLインポートまで失敗する。
 */
export function isDisallowedIPv4(address: string): boolean {
  const octets = address.split(".").map((s) => Number.parseInt(s, 10));
  if (octets.length !== 4 || octets.some((n) => !Number.isFinite(n) || n < 0 || n > 255)) {
    return true; // 解釈できない = 安全側で拒否
  }
  const [a, b, c] = octets as [number, number, number, number];

  if (a === 0) return true;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  // 192.0.0.0/24 (IETF protocol assignments) と 192.0.2.0/24 (TEST-NET-1) のみ。
  // 192.0.0.0/16 全体を拒否しないこと(上記コメント参照)。
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a >= 224) return true;

  return false;
}

/**
 * IPv6アドレス文字列を8つの16bitグループ(0〜0xffff)の数値配列へ展開する。
 * `::`圧縮・末尾埋め込みIPv4ドット10進表記の両方に対応する。パース不能な場合はnull。
 *
 * 文字列パターンマッチではなく数値展開を行うことで、同一アドレスの異なる
 * テキスト表記(例: `::ffff:127.0.0.1` と `::ffff:7f00:1`)に依らず同じ判定結果になる。
 */
function expandIPv6ToGroups(address: string): number[] | null {
  let addr = address;

  // 末尾が IPv4 ドット10進表記(例: "::ffff:127.0.0.1")の場合、
  // 2つの16bit16進グループへ変換してから通常のIPv6パースへ渡す。
  const lastColonIdx = addr.lastIndexOf(":");
  if (lastColonIdx !== -1) {
    const tail = addr.slice(lastColonIdx + 1);
    if (tail.includes(".")) {
      const octets = tail.split(".").map((s) => Number.parseInt(s, 10));
      if (
        octets.length !== 4 ||
        octets.some((n) => !Number.isFinite(n) || n < 0 || n > 255)
      ) {
        return null;
      }
      const [o0, o1, o2, o3] = octets as [number, number, number, number];
      const high = ((o0 << 8) | o1).toString(16);
      const low = ((o2 << 8) | o3).toString(16);
      addr = `${addr.slice(0, lastColonIdx + 1)}${high}:${low}`;
    }
  }

  const halves = addr.split("::");
  if (halves.length > 2) return null; // "::" が2箇所以上は不正

  const parseGroups = (s: string): number[] | null => {
    if (s === "") return [];
    const parts = s.split(":");
    const parsed = parts.map((g) => (g === "" ? NaN : Number.parseInt(g, 16)));
    if (parsed.some((n) => !Number.isFinite(n) || n < 0 || n > 0xffff)) return null;
    return parsed;
  };

  let groups: number[];
  if (halves.length === 2) {
    const head = parseGroups(halves[0]!);
    const tail = parseGroups(halves[1]!);
    if (head === null || tail === null) return null;
    const missing = 8 - head.length - tail.length;
    if (missing < 0) return null;
    groups = [...head, ...new Array(missing).fill(0), ...tail];
  } else {
    const parsed = parseGroups(addr);
    if (parsed === null) return null;
    groups = parsed;
  }

  if (groups.length !== 8) return null;
  return groups;
}

/**
 * IPv6アドレス文字列がloopback/unspecified/link-local/unique-local/
 * documentation/NAT64/multicast/IPv4-mapped私設アドレス等の拒否対象か判定する。
 * テキスト表記ではなく数値展開(`expandIPv6ToGroups`)して判定する。
 */
export function isDisallowedIPv6(address: string): boolean {
  const groups = expandIPv6ToGroups(address);
  if (groups === null) return true; // パース不能 = 安全側で拒否

  // "::" (unspecified)
  if (groups.every((g) => g === 0)) return true;

  // "::1" (loopback)
  if (groups.slice(0, 7).every((g) => g === 0) && groups[7] === 1) return true;

  // IPv4-mapped IPv6 (::ffff:0:0/96) — 下位32bitをIPv4として再判定
  if (
    groups[0] === 0 &&
    groups[1] === 0 &&
    groups[2] === 0 &&
    groups[3] === 0 &&
    groups[4] === 0 &&
    groups[5] === 0xffff
  ) {
    const g6 = groups[6]!;
    const g7 = groups[7]!;
    const mappedIPv4 = `${(g6 >> 8) & 0xff}.${g6 & 0xff}.${(g7 >> 8) & 0xff}.${g7 & 0xff}`;
    return isDisallowedIPv4(mappedIPv4);
  }

  // IPv4-compatible IPv6 (::/96、RFC 4291 §2.5.5.1、非推奨) — commit前review(BLOCKER)で
  // 発見。`::127.0.0.1`/`::169.254.169.254`/`::10.0.0.1`等が、上記のIPv4-mapped判定
  // (groups[5]===0xffff必須)にも"::"/"::1"判定にも一致せず素通りしていた。
  // 埋め込まれたIPv4部分がOS上で実際にどうルーティングされるかを断定する必要はなく、
  // 「テキスト表記の違いに影響されない判定」という本モジュールの設計原則上、この
  // 曖昧な特殊範囲そのものを一律拒否する(防御的判断)。"::"(全て0)と"::1"
  // (groups[7]のみ1)はこの直前の2チェックで既にreturn済みのため、ここに到達するのは
  // "::d.d.d.d"(dは0.0.0.0・0.0.0.1以外)の場合のみ。
  if (
    groups[0] === 0 &&
    groups[1] === 0 &&
    groups[2] === 0 &&
    groups[3] === 0 &&
    groups[4] === 0 &&
    groups[5] === 0
  ) {
    return true;
  }

  const g0 = groups[0]!;
  const g1 = groups[1]!;

  // fe80::/10 (link-local)
  if ((g0 & 0xffc0) === 0xfe80) return true;
  // fc00::/7 (unique local、fc00::/8 と fd00::/8 の両方を包含)
  if ((g0 & 0xfe00) === 0xfc00) return true;
  // 2001:db8::/32 (documentation)
  if (g0 === 0x2001 && g1 === 0x0db8) return true;
  // 64:ff9b::/96 (NAT64)
  if (
    g0 === 0x0064 &&
    g1 === 0xff9b &&
    groups[2] === 0 &&
    groups[3] === 0 &&
    groups[4] === 0 &&
    groups[5] === 0
  ) {
    return true;
  }
  // ff00::/8 (multicast、既存source-url-resolver.tsの網羅対象には無いが
  // ユニキャストHTTP接続先として有効なことはあり得ないため防御的に追加)
  if ((g0 & 0xff00) === 0xff00) return true;

  return false;
}

/** IPv4/IPv6を判定し、適切な拒否ロジックへ振り分ける。解釈不能なアドレスは安全側で拒否する。 */
export function isDisallowedAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) return isDisallowedIPv4(address);
  if (version === 6) return isDisallowedIPv6(address);
  return true;
}

export interface ResolvedAddress {
  address: string;
  family: 4 | 6;
}

export type HostSafetyFailureReason =
  | "disallowed_scheme"
  | "credentials_in_url"
  | "dns_lookup_failed"
  | "dns_no_records"
  | "dns_timeout"
  | "disallowed_ip_range";

export type HostSafety =
  | { ok: true; resolvedAddresses: ResolvedAddress[] }
  | { ok: false; reason: HostSafetyFailureReason };

class DnsTimeoutError extends Error {}

/** `promise`を`timeoutMs`とレースさせる。timeout側が勝った場合`DnsTimeoutError`でreject。
 *  Node標準の`dns.promises.lookup`はAbortSignalに対応しないため、基盤のgetaddrinfo
 *  呼出自体を強制キャンセルすることはできないが、呼び出し側の待機時間は
 *  `timeoutMs`を超えないことを保証する。 */
function raceWithTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new DnsTimeoutError("dns lookup timed out")), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/**
 * URLの安全性を検証する: スキーム → credentials → (IPリテラルなら直接、
 * そうでなければDNS解決して) IPレンジ、の順に判定する。
 *
 * IPv6 literal hostname(`url.hostname`が`"[::1]"`のように角括弧付き)は、
 * `isIP()`判定・DNS解決のいずれの前でも必ず角括弧を除去してから扱う
 * (既知バグ修正、モジュール先頭のコメント参照)。
 *
 * `opts.dnsTimeoutMs`は呼び出し側(safe-http-fetch.ts)が、redirectを跨いだ
 * total timeoutの残り時間予算に応じて短縮して渡すことを想定する
 * (DNS lookupがtotal timeoutの外で無制限に待機しないようにするため)。
 */
export async function validateExternalUrl(
  url: URL,
  opts?: { allowedSchemes?: readonly string[]; dnsTimeoutMs?: number },
): Promise<HostSafety> {
  const allowedSchemes = opts?.allowedSchemes ?? DEFAULT_ALLOWED_SCHEMES;

  if (!isAllowedScheme(url.protocol, allowedSchemes)) {
    return { ok: false, reason: "disallowed_scheme" };
  }
  if (hasCredentials(url)) {
    return { ok: false, reason: "credentials_in_url" };
  }

  const hostname = stripIPv6Brackets(url.hostname);
  const literalIpVersion = isIP(hostname);

  let candidateAddresses: ResolvedAddress[];

  if (literalIpVersion !== 0) {
    candidateAddresses = [{ address: hostname, family: literalIpVersion as 4 | 6 }];
  } else {
    const dnsTimeoutMs = opts?.dnsTimeoutMs ?? DEFAULT_DNS_TIMEOUT_MS;
    let lookupResult: dns.LookupAddress[];
    try {
      lookupResult = await raceWithTimeout(
        dns.promises.lookup(hostname, { all: true, verbatim: true }),
        dnsTimeoutMs,
      );
    } catch (err) {
      if (err instanceof DnsTimeoutError) {
        return { ok: false, reason: "dns_timeout" };
      }
      return { ok: false, reason: "dns_lookup_failed" };
    }
    if (lookupResult.length === 0) {
      return { ok: false, reason: "dns_no_records" };
    }
    candidateAddresses = lookupResult.map((r) => ({
      address: r.address,
      family: r.family as 4 | 6,
    }));
  }

  for (const { address } of candidateAddresses) {
    if (isDisallowedAddress(address)) {
      return { ok: false, reason: "disallowed_ip_range" };
    }
  }

  return { ok: true, resolvedAddresses: candidateAddresses };
}

function makeLookupNotFoundError(hostname: string): NodeJS.ErrnoException {
  const err = new Error(
    `createPinnedLookup: 要求されたfamilyに一致する検証済みアドレスがありません (${hostname})`,
  ) as NodeJS.ErrnoException;
  err.code = "ENOTFOUND";
  return err;
}

/**
 * 検証済みの実IPアドレス群へ接続を固定する`node:net.LookupFunction`を生成する
 * (DNS rebinding対策)。`validateExternalUrl`が安全と判定した直後のアドレスを
 * そのまま接続にも使うことで、「検証した時点」と「実際に接続する時点」の間で
 * 別IPへ再解決される攻撃を防ぐ。
 *
 * Node 18.13+の`net.Socket`は既定でHappy Eyeballs(RFC 8305、デュアルスタック
 * ホストへの並行接続)が有効であり、`options.all === true`の場合は
 * `dns.lookup`と同じく`callback(err, addresses: LookupAddress[])`という
 * **配列形式**でコールバックを呼び出す(単一の`(address, family)`形式ではない)。
 * この分岐を実装せずに常に単一形式で応答すると、Node内部の`net`モジュールが
 * `family`引数を誤って解釈し`ERR_INVALID_IP_ADDRESS`で接続に失敗する
 * (実機smokeで確認した実バグ)。`options.all`の有無で応答形式を出し分ける。
 *
 * `options.family`(4/6の明示指定)も尊重する(commit前review MEDIUM findingの修正)。
 * 事前検証済みの`addresses`から要求されたfamilyに一致するものだけを候補にする
 * (セキュリティ判定自体はここで一切緩和しない。候補が無い場合はNode
 * `LookupFunction`の慣例に従い`code:"ENOTFOUND"`のerrorをcallbackへ渡す)。
 */
export function createPinnedLookup(addresses: readonly ResolvedAddress[]): LookupFunction {
  if (addresses.length === 0) {
    throw new Error("createPinnedLookup: addresses は最低1件必要です");
  }

  function selectByFamily(family: number | undefined): ResolvedAddress[] {
    if (family === 4 || family === 6) {
      return addresses.filter((a) => a.family === family);
    }
    return addresses.slice();
  }

  const lookupFn: LookupFunction = (hostname, options, callback) => {
    if (typeof options === "function") {
      // 3引数呼出(options省略形): family指定を受け取れないため、検証済みアドレス
      // 先頭(familyフィルタ無し)を単一形式で返す。
      const cb = options as unknown as (
        err: NodeJS.ErrnoException | null,
        address: string,
        family: number,
      ) => void;
      const pick = addresses[0]!;
      cb(null, pick.address, pick.family);
      return;
    }

    const requestedFamily =
      typeof options === "object" && options !== null && "family" in options
        ? (options.family as number | undefined)
        : undefined;
    const wantsAll =
      typeof options === "object" && options !== null && "all" in options && options.all === true;

    const candidates = selectByFamily(requestedFamily);

    if (wantsAll) {
      const arrayCallback = callback as unknown as (
        err: NodeJS.ErrnoException | null,
        addresses: dns.LookupAddress[],
      ) => void;
      if (candidates.length === 0) {
        arrayCallback(makeLookupNotFoundError(hostname), []);
        return;
      }
      arrayCallback(
        null,
        candidates.map((a) => ({ address: a.address, family: a.family })),
      );
      return;
    }

    const pick = candidates[0];
    if (!pick) {
      callback(makeLookupNotFoundError(hostname), "", 0);
      return;
    }
    callback(null, pick.address, pick.family);
  };
  return lookupFn;
}
