/**
 * SSRF対策済みの安全なGET HTMLフェッチ(fix/url-import-ssrf-hardening)。
 *
 * `lib/url-parser/ogp.ts`(URL Import機能)が既存の脆弱な`fetch(url, {redirect:"follow"})`
 * 直呼びを置き換えるために新設する。`lib/security/url-safety.ts`の`validateExternalUrl`/
 * `createPinnedLookup`を用い、redirectのたびに安全性を再検証する手動redirectループを持つ。
 *
 * 標準の`fetch`ではなく`node:https`/`node:http`を直接使う。理由: DNS pinning
 * (検証済み実IPへ接続を固定してrebinding攻撃を防ぐ)に必要な`lookup`オプションは
 * `https.request`/`http.request`の`RequestOptions`にしかなく、標準`fetch`には存在しないため。
 *
 * ## Absolute deadline(commit前review HIGH findingの修正)
 *
 * Node標準の`http.request`/`https.request`の`timeout`オプションは**アイドル
 * (無通信)タイムアウト**であり、ソケット上に何らかの活動があるたびにリセットされる。
 * これだけに頼ると、悪意あるサーバーがidle timeout未満の間隔で小刻みにデータを
 * 送り続けるslow-loris的な挙動により、`totalTimeoutMs`を大幅に超えて接続が
 * 維持され続ける可能性がある。本モジュールは`requestOneHop`が返す`HopHandle.cancel()`を
 * `safeFetchHtml`側の`setTimeout`(絶対デッドライン基準、活動によってリセットされない)
 * から呼び出すことで、DNS解決・接続・ヘッダ受信・redirect追跡・body読込の**全て**を
 * 単一の絶対デッドライン内に強制収める。
 *
 * ## Security invariant: 過去hopのnetwork connectionを残さない(PR #199 review HIGH findingの修正)
 *
 * 各hopは、次のいずれかの経路で確定した瞬間に、そのhopが保持するnetwork resource
 * (`req`/`res`のsocket)を必ず手放す:
 *
 * - **final response**(redirectではない最終応答): body完了(`end`)/`error`/
 *   `timeout`のいずれかでsocketを終了する。
 * - **redirect response**: Locationを取得した時点で、bodyの完了を待たず
 *   ただちに旧socketを終了する(`res.resume()`によるbodyの受動的drainでは、
 *   悪意あるサーバーがidle timeout未満の間隔で小刻みにbodyを送り続けた場合に
 *   socketがバックグラウンドで残り続けてしまうため、これは行わない)。
 * - **cancelled response**: 絶対デッドライン等で既にhopが確定済みの後に
 *   headersが届いた場合、drainせず即座に破棄する。
 *
 * したがって`safeFetchHtml`が返った時点で、過去のいずれのhopのnetwork connectionも
 * バックグラウンドに残らない。
 */

import "server-only";

import * as https from "node:https";
import * as http from "node:http";
import type { IncomingMessage, ClientRequest } from "node:http";
import type { LookupFunction } from "node:net";
import {
  validateExternalUrl,
  createPinnedLookup,
  DEFAULT_ALLOWED_SCHEMES,
  type HostSafetyFailureReason,
} from "./url-safety";

export type SafeFetchFailureReason =
  | "invalid_url"
  | HostSafetyFailureReason
  | "too_many_redirects"
  | "invalid_redirect_location"
  | "timeout"
  | "body_too_large"
  | "disallowed_content_type"
  | "http_error"
  | "network_error";

export interface SafeFetchOptions {
  /** 既定 ["http:", "https:"]。用途に応じて呼び出し側で ["https:"] 等に絞り込める。 */
  allowedSchemes?: readonly string[];
  /** 追跡する最大redirect回数。既定 5。 */
  maxRedirects?: number;
  /** 1 hop あたりのNode idle(無通信)timeout(ms)。既定 5000。絶対デッドライン
   *  (`totalTimeoutMs`)による強制打ち切りとは独立した、早期検知用の補助的な値。 */
  hopTimeoutMs?: number;
  /** リクエスト全体(redirect込み、DNS lookup・接続・ヘッダ受信・body読込すべて含む)の
   *  絶対デッドライン(ms)。既定 8000。activityによってリセットされない。 */
  totalTimeoutMs?: number;
  /** 読み込む本文の最大バイト数。既定 2,000,000 (2MB)。 */
  maxBodyBytes?: number;
  /** Content-Type許可判定。既定は text/html, application/xhtml+xml のみ許可
   *  (charset等のパラメータは無視してMIMEタイプ部分のみ比較)。ヘッダ自体が
   *  存在しない場合は許可する(既存fetchOgpがContent-Type未設定のレスポンスも
   *  そのまま解析していた挙動を維持するため)。 */
  isAllowedContentType?: (contentType: string | undefined) => boolean;
  /** 追加リクエストヘッダ。`Accept-Encoding: identity`等の既定ヘッダを上書きしない
   *  拡張用途のみに使うこと。 */
  headers?: Record<string, string>;
}

/**
 * 失敗時は定型`reason`コードのみを返す(commit前review Finding #6の修正)。
 * 生のNodeエラーメッセージ(`connect ECONNREFUSED <ip>:<port>`等、接続先IPを含みうる)を
 * 戻り値として外部へ渡さない。詳細情報が必要な場合もログへは出さず、`reason`の
 * 種別のみで診断する方針を維持する(過剰なlogging追加はしない)。
 */
export type SafeFetchResult =
  | { ok: true; status: number; finalUrl: string; body: string; contentType: string | undefined }
  | { ok: false; reason: SafeFetchFailureReason };

const DEFAULT_MAX_REDIRECTS = 5;
const DEFAULT_HOP_TIMEOUT_MS = 5000;
const DEFAULT_TOTAL_TIMEOUT_MS = 8000;
const DEFAULT_MAX_BODY_BYTES = 2_000_000;

/** redirectとして追跡するHTTPステータス。それ以外の3xx(300/304/305/306等)や
 *  Location欠落の3xxはredirectとして扱わずfinal responseとして処理する。 */
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

const DEFAULT_ALLOWED_CONTENT_TYPES = new Set(["text/html", "application/xhtml+xml"]);

function defaultIsAllowedContentType(contentType: string | undefined): boolean {
  if (contentType === undefined) return true;
  const mime = contentType.split(";")[0]?.trim().toLowerCase() ?? "";
  return DEFAULT_ALLOWED_CONTENT_TYPES.has(mime);
}

/** hop単位の失敗を表す内部エラー。`reason`をそのまま`SafeFetchResult`へ伝播させる。 */
class HopError extends Error {
  constructor(
    public readonly reason: SafeFetchFailureReason,
    message?: string,
  ) {
    super(message ?? reason);
  }
}

type HopResult =
  | { kind: "redirect"; location: string }
  | { kind: "final"; status: number; body: string; contentType: string | undefined };

interface HopOptions {
  timeoutMs: number;
  maxBodyBytes: number;
  isAllowedContentType: (ct: string | undefined) => boolean;
  headers: Record<string, string>;
}

/**
 * `requestOneHop`の戻り値。`promise`は1hop分の結果を表し、`cancel()`は
 * 外部(呼び出し側の絶対デッドラインtimer)から強制終了させるための関数。
 * `cancel()`は何度呼ばれても安全(既に確定済みなら何もしない)。
 */
interface HopHandle {
  promise: Promise<HopResult>;
  cancel: (reason: SafeFetchFailureReason) => void;
}

/**
 * 1 hop 分のGETリクエストを行う。redirect検出時は`{kind:"redirect"}`で解決し、
 * それ以外はbodyを読み切って`{kind:"final"}`で解決する。
 *
 * commit前review Finding #2/#7の修正: `settled`ガードを持つ`settleResolve`/
 * `settleReject`経由でのみ確定させることで、
 * timeout / body_too_large / disallowed_content_type / disallowed_content_encoding /
 * network_error / redirect のいずれが競合しても二重発火しないことを保証する。
 * `cancel()`は外部の絶対デッドラインtimerから呼ばれ、`req`/`res`が生成済みなら
 * 両方を`destroy()`したうえで`HopError(reason)`によりreject確定させる。
 */
function requestOneHop(url: URL, lookup: LookupFunction, opts: HopOptions): HopHandle {
  let settled = false;
  // `req`はこの関数末尾で`client.request(...)`により一度だけ代入される。
  // `destroyAll`/`cancel`(下記)はこの`req`をクロージャ経由で参照するが、
  // 実際に呼ばれるのは`client.request(...)`実行(同期)より後(response/error/timeout
  // イベント、または外部からの`cancel()`呼出はrequestOneHopが値を返した後)のみのため、
  // 参照時点では常に初期化済みであることが保証される。
  let res: IncomingMessage | undefined;
  let resolveFn!: (r: HopResult) => void;
  let rejectFn!: (e: unknown) => void;

  const promise = new Promise<HopResult>((resolve, reject) => {
    resolveFn = resolve;
    rejectFn = reject;
  });

  function settleResolve(r: HopResult): void {
    if (settled) return;
    settled = true;
    resolveFn(r);
  }
  function settleReject(e: unknown): void {
    if (settled) return;
    settled = true;
    rejectFn(e);
  }
  function destroyAll(): void {
    try {
      res?.destroy();
    } catch {
      /* 既にdestroy済み等は無視(destroy自体は例外を投げない実装がほとんどだが念のため防御) */
    }
    try {
      req?.destroy();
    } catch {
      /* 同上 */
    }
  }
  function cancel(reason: SafeFetchFailureReason): void {
    if (settled) return;
    destroyAll();
    settleReject(new HopError(reason));
  }

  const client = url.protocol === "https:" ? https : http;
  const hostname =
    url.hostname.startsWith("[") && url.hostname.endsWith("]")
      ? url.hostname.slice(1, -1)
      : url.hostname;

  const req: ClientRequest = client.request(
    {
      method: "GET",
      protocol: url.protocol,
      hostname,
      port: url.port || (url.protocol === "https:" ? 443 : 80),
      path: `${url.pathname}${url.search}`,
      lookup,
      timeout: opts.timeoutMs,
      headers: opts.headers,
    },
    (incoming: IncomingMessage) => {
      if (settled) {
        // 絶対デッドライン等で既にcancel済みの場合、drainする理由はなく即座に破棄する
        // (commit後review HIGH findingの修正: resume()で受動的にdrainし続けると、
        // network resourceがバックグラウンドに残り続ける)。destroy()が非同期に
        // 'error' を発生させてもプロセスをクラッシュさせないよう、破棄前に
        // no-opのerrorハンドラを付けておく(settled済みのため結果には無関係)。
        incoming.on("error", () => {});
        incoming.destroy();
        return;
      }
      res = incoming;

      // redirect/final/破棄後いずれの経路でも、unhandled 'error' event による
      // プロセスクラッシュを防ぐため最初に登録する(以前はfinal経路でのみ
      // 登録しており、redirect経路のresには一切errorハンドラが無かった)。
      res.on("error", (err: Error) => {
        if (settled) return;
        destroyAll();
        settleReject(new HopError("network_error", err.message));
      });

      const status = res.statusCode ?? 0;
      const location = res.headers.location;
      if (REDIRECT_STATUSES.has(status) && typeof location === "string" && location.length > 0) {
        // security invariant: 各hopはresolve/reject確定と同時にnetwork resourceを
        // 手放す。redirect先へ進む場合も、旧hopのbodyがidle timeout未満の間隔で
        // 小刻みに送られ続けるような悪意あるサーバーに対し、bodyの完了を待たず
        // settle直後にsocket自体を終了する(commit後review HIGH findingの修正)。
        // settleResolveを先に実行してsettled=trueにしてから破棄することで、
        // destroy()に伴い後から発生しうるdata/error/closeイベントは全て
        // 上記の`if (settled) return`ガードで無視され、二重settleや
        // redirect結果のnetwork_errorへの化けを防ぐ。
        settleResolve({ kind: "redirect", location });
        destroyAll();
        return;
      }

      // Accept-Encoding: identity を要求しているが、これを無視して圧縮本文を
      // 返すサーバーが稀に存在する。圧縮バイナリをHTMLとして誤解析しないよう、
      // content-encoding が identity 以外なら拒否する。
      const contentEncoding = res.headers["content-encoding"];
      if (typeof contentEncoding === "string" && contentEncoding.toLowerCase() !== "identity") {
        destroyAll();
        settleReject(new HopError("disallowed_content_type", "unexpected content-encoding"));
        return;
      }

      const contentType = res.headers["content-type"];
      if (!opts.isAllowedContentType(contentType)) {
        destroyAll();
        settleReject(new HopError("disallowed_content_type"));
        return;
      }

      const declaredLength = Number(res.headers["content-length"] ?? "");
      if (Number.isFinite(declaredLength) && declaredLength > opts.maxBodyBytes) {
        destroyAll();
        settleReject(new HopError("body_too_large"));
        return;
      }

      const chunks: Buffer[] = [];
      let total = 0;
      res.on("data", (chunk: Buffer) => {
        if (settled) return;
        total += chunk.length;
        if (total > opts.maxBodyBytes) {
          // Content-Length偽装・chunked encoding両対応: ヘッダ宣言値に依らず、
          // 実際に読み込んだ累積バイト数がこの時点で上限を超えたら即座に
          // ソケットを破棄し、それ以上読み続けない。
          destroyAll();
          settleReject(new HopError("body_too_large"));
          return;
        }
        chunks.push(chunk);
      });
      res.on("end", () => {
        if (settled) return;
        settleResolve({
          kind: "final",
          status,
          body: Buffer.concat(chunks).toString("utf-8"),
          contentType,
        });
      });
    },
  );

  req.on("timeout", () => {
    // Node標準のidle(無通信)timeout。絶対デッドラインとは独立した早期検知として維持する。
    cancel("timeout");
  });
  req.on("error", (err: Error) => {
    if (settled) return;
    destroyAll(); // reqが自らerrorを出した場合もresが残っていれば念のため破棄する
    if (err instanceof HopError) {
      settleReject(err);
    } else {
      settleReject(new HopError("network_error", err.message));
    }
  });
  req.end();

  return { promise, cancel };
}

/**
 * 安全なGET HTMLフェッチ。redirectのたびに`validateExternalUrl`を再実行し、
 * スキーム・credentials・DNS解決・IPレンジをすべて再検証してから接続する。
 *
 * DNS lookupも含めた全処理(hop毎のDNS解決・接続・ヘッダ受信・redirect追跡・body読込)を
 * `totalTimeoutMs`で指定した**絶対デッドライン**の範囲に収める。各hop開始時に
 * 残り時間を再計算し、DNS lookup・HTTP hopの両方へ「残り時間」を渡すのに加え、
 * hop実行中は`setTimeout(..., remaining)`から`HopHandle.cancel("timeout")`を呼ぶ
 * ことで、Node標準のidle timeoutでは検知できないslow-loris的な小刻みデータ送信
 * (idle timeout未満の間隔でのdata送信)に対しても、絶対デッドライン到達時点で
 * 強制的にreq/resをdestroyしてPromiseを確定させる(commit前review Finding #2の修正)。
 */
export async function safeFetchHtml(
  url: string,
  options?: SafeFetchOptions,
): Promise<SafeFetchResult> {
  const allowedSchemes = options?.allowedSchemes ?? DEFAULT_ALLOWED_SCHEMES;
  const maxRedirects = options?.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  const hopTimeoutMs = options?.hopTimeoutMs ?? DEFAULT_HOP_TIMEOUT_MS;
  const totalTimeoutMs = options?.totalTimeoutMs ?? DEFAULT_TOTAL_TIMEOUT_MS;
  const maxBodyBytes = options?.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
  const isAllowedContentType = options?.isAllowedContentType ?? defaultIsAllowedContentType;
  const headers: Record<string, string> = {
    "User-Agent": "Mozilla/5.0 (compatible; FirstWebReserchAI/1.0; +https://firstweb.example.com)",
    Accept: "text/html,application/xhtml+xml",
    "Accept-Language": "ja,en-US;q=0.9,en;q=0.8",
    // 圧縮レスポンスを要求しない(未展開バイナリをHTMLとして誤解析しないための単純化、
    // decompression実装はV1スコープ外)。
    "Accept-Encoding": "identity",
    ...options?.headers,
  };

  let current: URL;
  try {
    current = new URL(url);
  } catch {
    return { ok: false, reason: "invalid_url" };
  }

  const deadline = Date.now() + totalTimeoutMs;

  for (let hop = 0; hop <= maxRedirects; hop++) {
    const remainingBeforeDns = deadline - Date.now();
    if (remainingBeforeDns <= 0) {
      return { ok: false, reason: "timeout" };
    }

    const safety = await validateExternalUrl(current, {
      allowedSchemes,
      dnsTimeoutMs: Math.min(remainingBeforeDns, hopTimeoutMs),
    });
    if (!safety.ok) {
      return { ok: false, reason: safety.reason };
    }

    const remainingAfterDns = deadline - Date.now();
    if (remainingAfterDns <= 0) {
      return { ok: false, reason: "timeout" };
    }

    const pinnedLookup = createPinnedLookup(safety.resolvedAddresses);

    const hopHandle = requestOneHop(current, pinnedLookup, {
      timeoutMs: Math.min(remainingAfterDns, hopTimeoutMs),
      maxBodyBytes,
      isAllowedContentType,
      headers,
    });

    // 絶対デッドライン強制: activityでリセットされないsetTimeoutから
    // cancel()を呼ぶ。hop自然完了時はfinallyでclearTimeoutし、timer残留を防ぐ。
    const deadlineTimer = setTimeout(() => {
      hopHandle.cancel("timeout");
    }, Math.max(remainingAfterDns, 0));

    let hopResult: HopResult;
    try {
      hopResult = await hopHandle.promise;
    } catch (err) {
      const reason = err instanceof HopError ? err.reason : "network_error";
      return { ok: false, reason };
    } finally {
      clearTimeout(deadlineTimer);
    }

    if (hopResult.kind === "redirect") {
      let next: URL;
      try {
        next = new URL(hopResult.location, current);
      } catch {
        return { ok: false, reason: "invalid_redirect_location" };
      }
      current = next;
      continue;
    }

    return {
      ok: true,
      status: hopResult.status,
      finalUrl: current.toString(),
      body: hopResult.body,
      contentType: hopResult.contentType,
    };
  }

  return { ok: false, reason: "too_many_redirects" };
}
