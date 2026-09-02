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
  | "incomplete_data"
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
 * Places が 2xx を返したが、必須フィールド (id / displayName.text / formattedAddress /
 * location) が欠けていて `PlaceDetailsResult` を組み立てられない状態。
 *
 * **外部由来のテキストを含まない、アプリ自身が書いたドメイン例外**である点が
 * `PlacesApiError` と決定的に違う。Google 側のレコード内容に起因する決定的な失敗
 * なので、再試行で解消しない。分類器がこれを `"unknown"` に落とすと fallback 文言
 * (「時間をおいて再度お試しください」) になり、無駄な再試行 = 余分な Places 呼び出しを
 * 誘発するため、専用 kind を持たせる (#221 review)。
 *
 * message は型付きエラー化以前と同一文言を維持する (後方互換。`PlacesApiKeyMissingError`
 * と同じ方針)。
 */
export class PlacesIncompleteDataError extends Error {
  constructor() {
    super("店舗情報が不足しているため詳細を取得できませんでした");
    this.name = "PlacesIncompleteDataError";
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

/**
 * 型付きエラー化以前の生 `Error` message 形式。`lib/places/google.ts` が投げていた
 * 文言そのものだけを認める。
 *
 * ## 先頭一致に限定する理由 (#221 review)
 *
 * `classifyPlacesError` は Places 由来かどうかを問わず**あらゆる catch のエラー**へ
 * 適用される。部分一致にすると、message の中に第三者由来のテキストを含むエラーが
 * Places 由来と誤判定される。具体的には Drizzle の `DrizzleQueryError.message` は
 * `Failed query: <sql>\nparams: <params>` 形式で、`params` にはユーザーが入力した
 * 検索キーワードがそのまま載る。キーワードに `エラー (503)` を含めて検索すると、
 * 候補DB の失敗が `kind: "server_error"` へ誤分類され、`parsePostgresError` が
 * 走らなくなって `code` / `constraint` / `table` / `stack` が丸ごと落ちる。
 *
 * 旧実装が投げていた message は必ずこの形で始まるため、先頭一致でも後方互換は保たれる。
 */
const LEGACY_API_ERROR_MESSAGE = /^Places API エラー \((\d{3})\)/;
const LEGACY_API_KEY_MISSING_MESSAGE = /^GOOGLE_PLACES_API_KEY /;

function isApiKeyMissingError(err: unknown): boolean {
  if (typeof err === "object" && err !== null && (err as { name?: unknown }).name === "PlacesApiKeyMissingError") {
    return true;
  }
  // 後方互換: 型付きエラー化以前の生 `Error` 経路 (他モジュール由来の再 throw 等)。
  const message = err instanceof Error ? err.message : String(err);
  return LEGACY_API_KEY_MISSING_MESSAGE.test(message);
}

/**
 * `PlacesIncompleteDataError` 判定。他の判定と同様、`instanceof` ではなく `name` を見る。
 * 生 `Error` への後方互換 fallback は置かない (この文言を投げるのは `lib/places/google.ts`
 * の 1 箇所だけで、型付きエラー化以前の値が永続化される経路が無いため)。
 */
function isIncompleteDataError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { name?: unknown }).name === "PlacesIncompleteDataError"
  );
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
  // 先頭一致に限定する理由は `LEGACY_API_ERROR_MESSAGE` を参照。
  const message = err instanceof Error ? err.message : String(err);
  const match = message.match(LEGACY_API_ERROR_MESSAGE);
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
  if (isIncompleteDataError(err)) return "incomplete_data";
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
  if (isIncompleteDataError(err)) return "incomplete_data";
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
 * ## 文脈非依存であること (#221 review)
 *
 * このテーブルは検索 (`searchPlacesWithMatchesAction` / `searchPlacesAction`)・詳細取得
 * (`getPlaceDetailsForAreaSearchAction`)・追加 (`addStoreFromPlaceAction`) の
 * **4 アクションで共用**する。したがって主語を「店舗検索」に固定せず、どの導線から
 * 出ても成立する表現にする。特に「条件を変えて」のような**その画面に存在しない操作**を
 * 促す文言は、ユーザーが取りようのない行動へ誘導するため置かない。
 * アクション固有の文脈は、呼び出し側が渡す `fallback` 文言が担う。
 *
 * `"unknown"` だけは `null` = 「呼び出し側が指定した fallback 文言を使う」。
 * 分類できないエラー (Postgres エラーや想定外の例外) の message を UI へ流さないための
 * 明示的な穴埋めであり、ここが本 Issue の中核。
 */
export const PLACES_USER_MESSAGES: Record<PlacesErrorKind, string | null> = {
  missing_api_key: "店舗情報サービスの設定に問題があります。管理者にお問い合わせください。",
  timeout: "店舗情報の取得が時間内に完了しませんでした。時間をおいて再度お試しください。",
  rate_limited: "店舗情報サービスの利用が集中しています。少し時間をおいて再度お試しください。",
  permission_denied: "店舗情報サービスを利用できませんでした。管理者にお問い合わせください。",
  not_found: "対象の店舗情報が見つかりませんでした。別の候補をお試しください。",
  // 検索・詳細取得・追加のどこから出ても取れる行動だけを示す (#221 review)。
  // 4xx は決定的な失敗なので「時間をおいて」は促さず、やり直しでも直らない場合の
  // エスカレーション先だけを示す。「検索条件」のような特定導線の語彙は使わない。
  invalid_request:
    "店舗情報を取得できませんでした。やり直しても解決しない場合は管理者にお問い合わせください。",
  server_error: "店舗情報サービスが一時的に利用できません。時間をおいて再度お試しください。",
  // 再試行で解消しない決定的な失敗なので、他と違い「時間をおいて」を含めない (#221 review)。
  incomplete_data:
    "この店舗は詳細情報が公開されていないため取得できませんでした。別の候補をお試しください。",
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
