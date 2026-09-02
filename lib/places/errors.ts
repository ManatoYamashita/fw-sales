import "server-only";

/**
 * Google Places API 失敗時のエラー型と、その sanitize (Issue #201)。
 *
 * ## 背景
 *
 * 従来 `lib/places/google.ts` は `Error("Places API エラー (${status}): ${await response.text()}")`
 * を投げており、Google の**生レスポンス本文**が `Error.message` に載っていた。
 * `lib/actions/area-search-actions.ts` はそれを `failure(e.message)` でそのまま返して
 * いたため、外部 API の生本文がユーザー向け UI まで到達しうる状態だった。
 *
 * ## 設計
 *
 * 「UI へは sanitize 済み文言のみ / 診断情報は `console.error` の構造化ログへ」という
 * PR #144 以来の規約 (`lib/security/safe-http-fetch.ts` 冒頭に詳述) を Places 側にも適用する。
 * 本文は `google.ts` が投げる**前に**構造化ログへ 1 度だけ出し、エラー自体は
 * status のみを持つ型付きエラーとして伝播させる。
 *
 * ## 後方互換
 *
 * `PlacesApiError.message` は `Places API エラー (${status})` 形式を維持する
 * (本文だけを落とす)。これにより message を文字列パースしている既存の呼び出し元
 * — `lib/url-parser/places-fallback.ts` — と、その回帰テストが壊れない。
 * キー未設定エラーの message も従来と同一文言を保つ。
 */

/**
 * Places API 失敗の分類。ユーザー向け文言・診断ログの双方をこの値から導出する。
 * 生レスポンス本文・API キー・リクエスト情報は一切含まない閉じた語彙。
 */
export type PlacesErrorKind =
  | "missing_api_key"
  | "timeout"
  | "rate_limited"
  | "permission_denied"
  | "not_found"
  | "invalid_request"
  | "server_error"
  | "unknown";

/**
 * Places API が非 2xx を返したことを表すエラー。
 *
 * **レスポンス本文は保持しない。** 本文は投げる側 (`lib/places/google.ts` の
 * `throwPlacesApiError`) が構造化ログへ出す責務を負い、ここへは持ち込まない。
 */
export class PlacesApiError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`Places API エラー (${status})`);
    this.name = "PlacesApiError";
    this.status = status;
  }
}

/** `GOOGLE_PLACES_API_KEY` 未設定。message は従来文言を維持する (後方互換)。 */
export class PlacesApiKeyMissingError extends Error {
  constructor() {
    super("GOOGLE_PLACES_API_KEY が設定されていません");
    this.name = "PlacesApiKeyMissingError";
  }
}

/**
 * `instanceof` ではなく `name` + プロパティ形状で判定する。
 *
 * `lib/db/postgres-error.ts` の教訓と同じ理由: Vitest の module mock や bundler の
 * chunk 跨ぎでクラス実体が二重化すると `instanceof` は落ちるが、`name` 判定は頑健。
 */
function asPlacesApiError(err: unknown): { status: number } | null {
  if (typeof err !== "object" || err === null) return null;
  const e = err as { name?: unknown; status?: unknown };
  return e.name === "PlacesApiError" && typeof e.status === "number"
    ? { status: e.status }
    : null;
}

function isApiKeyMissingError(err: unknown): boolean {
  if (typeof err === "object" && err !== null && (err as { name?: unknown }).name === "PlacesApiKeyMissingError") {
    return true;
  }
  // 後方互換: 型付きエラー化以前の生 `Error` 経路 (他モジュール由来の再 throw 等)。
  const message = err instanceof Error ? err.message : String(err);
  return message.includes("GOOGLE_PLACES_API_KEY");
}

/**
 * 明示 timeout (`AbortSignal.timeout`) 由来の中断。`AbortSignal.timeout` は
 * `TimeoutError`、外部からの明示 abort は `AbortError` を投げる。いずれも
 * 「Places が応答しなかった」として同じ扱いでよい。
 */
function isTimeoutError(err: unknown): boolean {
  return err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
}

/** `PlacesApiError` の HTTP status。Places 由来でなければ undefined。 */
export function getPlacesErrorStatus(err: unknown): number | undefined {
  const parsed = asPlacesApiError(err);
  if (parsed) return parsed.status;
  // 後方互換: 型付きエラー化以前の message 形式からの抽出。
  const message = err instanceof Error ? err.message : String(err);
  const match = message.match(/エラー \((\d{3})\)/);
  return match ? Number(match[1]) : undefined;
}

/** HTTP status を `PlacesErrorKind` へ写す。 */
function kindFromStatus(status: number): PlacesErrorKind {
  if (status === 429) return "rate_limited";
  if (status === 401 || status === 403) return "permission_denied";
  if (status === 404) return "not_found";
  if (status >= 400 && status < 500) return "invalid_request";
  if (status >= 500) return "server_error";
  return "unknown";
}

/**
 * 任意のエラーを `PlacesErrorKind` へ分類する。
 * Places 由来と判別できないもの (Postgres エラー等) は `"unknown"`。
 */
export function classifyPlacesError(err: unknown): PlacesErrorKind {
  if (isTimeoutError(err)) return "timeout";
  if (isApiKeyMissingError(err)) return "missing_api_key";
  const status = getPlacesErrorStatus(err);
  return status === undefined ? "unknown" : kindFromStatus(status);
}

/**
 * AI 店舗調査 (`lib/ai/research/places-stage0.ts`) が warning 文言へ埋め込む診断種別。
 *
 * `api_error:<status>` という既存フォーマットを維持する (この文字列は
 * 「Google Places再同期に失敗しました (${kind})」としてユーザーの目に触れるため、
 * 文言の回帰を避ける)。生レスポンス本文は一切含めない。
 */
export function toPlacesDiagnosticKind(err: unknown): string {
  if (isTimeoutError(err)) return "timeout";
  if (isApiKeyMissingError(err)) return "missing_api_key";
  const status = getPlacesErrorStatus(err);
  return status === undefined ? "unknown" : `api_error:${status}`;
}

/**
 * `PlacesErrorKind` に対応するユーザー向け文言。
 *
 * 技術用語 (HTTP status / Google / API キー / エンドポイント名) は出さない。
 * ユーザーが知りたいのは内部詳細ではなく「次に何をすればよいか」なので、すべて
 * 次の行動を含む文にする (`registration-mode-card.tsx` の `REJECT_MESSAGE` と同じ規約)。
 * 診断情報はサーバー側の構造化ログが担う。
 *
 * `"unknown"` だけは `null` = 「呼び出し側が指定した fallback 文言を使う」。
 * 分類できないエラー (Postgres エラーや想定外の例外) の message を UI へ流さないための
 * 明示的な穴埋めであり、ここが本 Issue の中核。
 */
export const PLACES_USER_MESSAGES: Record<PlacesErrorKind, string | null> = {
  missing_api_key: "店舗検索の設定に問題があります。管理者にお問い合わせください。",
  timeout: "店舗検索が時間内に完了しませんでした。時間をおいて再度お試しください。",
  rate_limited: "店舗検索の利用が集中しています。少し時間をおいて再度お試しください。",
  permission_denied: "店舗検索を利用できませんでした。管理者にお問い合わせください。",
  not_found: "対象の店舗情報が見つかりませんでした。別の候補で再度お試しください。",
  invalid_request: "この条件では店舗検索を実行できませんでした。条件を変えて再度お試しください。",
  server_error: "店舗検索サービスが一時的に利用できません。時間をおいて再度お試しください。",
  unknown: null,
};

/**
 * エラーをユーザー向け文言へ変換する。`lib/db/postgres-error.ts` の
 * `formatUserMessage(parsed, fallback)` と同型のシグネチャ。
 *
 * **`err` の message は決して戻り値に含めない。** 分類できない場合は必ず `fallback`
 * を返す。`formatUserMessage` は未知 SQLSTATE のとき `[code] message` と生 message を
 * 返すため、この経路では併用しない (Issue #201 の趣旨と衝突する)。
 */
export function toUserFacingPlacesMessage(err: unknown, fallback: string): string {
  return PLACES_USER_MESSAGES[classifyPlacesError(err)] ?? fallback;
}
