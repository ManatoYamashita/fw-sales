/**
 * postgres-js が投げる `PostgresError` を構造化解析するユーティリティ。
 *
 * 役割:
 * - Action 層の `catch (err)` で受け取る `unknown` から、Postgres 側の
 *   `code` (SQLSTATE) / `detail` / `constraint_name` / `table_name` 等を取り出す。
 * - Drizzle wrapper を経由して再 throw された場合に備え、`cause` チェーンを
 *   有限段数 (5 段) 辿って PostgresError を発見する。
 * - SQLSTATE ごとに日本語フレンドリーなユーザーメッセージへ整形する。
 *
 * 設計判断:
 * - `import { PostgresError } from "postgres"` の直 import は避け、duck typing
 *   (`name === "PostgresError"` + `typeof code === "string"`) で検出する。
 *   - 理由 1: テストで mock を作りやすい (plain object で再現可能)。
 *   - 理由 2: `instanceof` は Vitest の module mock や bundler chunk 跨ぎで
 *     失敗するケースがあり、name 判定の方が頑健。
 * - 純関数のみ。`server-only` を冒頭に置き、Client バンドルへの混入を防ぐ。
 *
 * 関連: lib/actions/store-actions.ts (bulkDeleteStoresAction / deleteStoreAction)、
 *       lib/db/store-repository.ts (bulkDelete の transaction wrap)
 */

import "server-only";

export interface ParsedPgError {
  /** SQLSTATE (例 "57014") */
  code: string;
  /** 生 message。Drizzle wrapper の "Failed query: ..." が入ることもある */
  message: string;
  detail?: string;
  hint?: string;
  constraint?: string;
  table?: string;
  column?: string;
  schema?: string;
  severity?: string;
  where?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function pickNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

/**
 * `err` から PostgresError 互換 (もしくは `code` を持つ任意のエラー) を探す。
 * Drizzle wrapper を含む `cause` チェーンを最大 5 段までさかのぼる。
 *
 * 2 段検出:
 * - 第 1 段 (優先): postgres-js `PostgresError` (`name === "PostgresError"` + code 持ち)。
 *   SQLSTATE 形式 (`23503` 等) の真のサーバーエラー。これを最優先で返す。
 * - 第 2 段 (fallback): `name` は無関係に `typeof code === "string" && code !== ""` の
 *   任意のエラー。これにより postgres-js の `generic(code, message)` (例:
 *   `UNSAFE_TRANSACTION` / `MAX_PARAMETERS_EXCEEDED` 等の client-side エラー) や
 *   `connection(...)` (例: `ECONNREFUSED`) も検出できる。これらは `name === "Error"`
 *   のため第 1 段では拾えなかった (PR #144 で本番症状として顕在化)。
 *
 * チェーン全体を辿りつつ、PostgresError が見つかれば即返却、見つからなければ
 * 最初に見つかった「code 持ち」エラーを返す。どちらも無ければ null。
 */
function unwrapToPostgresError(
  err: unknown,
): (Record<string, unknown> & { code: string }) | null {
  let current: unknown = err;
  let firstWithCode: (Record<string, unknown> & { code: string }) | null = null;
  for (let depth = 0; depth < 5; depth++) {
    if (!isRecord(current)) break;
    const hasStringCode =
      typeof current.code === "string" && current.code !== "";
    if (current.name === "PostgresError" && hasStringCode) {
      return current as Record<string, unknown> & { code: string };
    }
    if (hasStringCode && firstWithCode === null) {
      firstWithCode = current as Record<string, unknown> & { code: string };
    }
    current = current.cause;
  }
  return firstWithCode;
}

/**
 * 未知の throw を `ParsedPgError` に変換する。PostgresError が見つからなければ null。
 */
export function parsePostgresError(err: unknown): ParsedPgError | null {
  const target = unwrapToPostgresError(err);
  if (!target) return null;
  return {
    code: target.code,
    message: typeof target.message === "string" ? target.message : "",
    detail: pickNonEmptyString(target.detail),
    hint: pickNonEmptyString(target.hint),
    constraint:
      pickNonEmptyString(target.constraint_name) ??
      pickNonEmptyString(target.constraint),
    table:
      pickNonEmptyString(target.table_name) ??
      pickNonEmptyString(target.table),
    column:
      pickNonEmptyString(target.column_name) ??
      pickNonEmptyString(target.column),
    schema:
      pickNonEmptyString(target.schema_name) ??
      pickNonEmptyString(target.schema),
    severity:
      pickNonEmptyString(target.severity_local) ??
      pickNonEmptyString(target.severity),
    where: pickNonEmptyString(target.where),
  };
}

type Formatter = (parsed: ParsedPgError) => string;

const SQLSTATE_MESSAGES: Record<string, Formatter> = {
  // foreign_key_violation
  // constraint 名は内部スキーマ情報のため UI には出さず、構造化ログ
  // (Action 層の console.error) にのみ残す (PR #144 セルフレビュー容疑 A 対応)。
  "23503": () =>
    "関連レコードに紐づいているため削除できませんでした。スキーマの ON DELETE 設定を確認してください。",
  // unique_violation
  "23505": () => "一意制約に違反しました。",
  // not_null_violation
  "23502": (p) => {
    const c = p.column ? ` (列: ${p.column})` : "";
    return `必須項目が未入力です${c}。`;
  },
  // query_canceled (statement_timeout も同コード)
  "57014": () =>
    "処理がタイムアウトしました。件数を減らすか、時間を空けて再試行してください。",
  // insufficient_privilege
  "42501": () =>
    "データベース権限が不足しています。管理者に連絡してください。",
  // connection_failure / connection_does_not_exist / sqlclient_unable_to_establish_sqlconnection
  "08006": () => "データベース接続が切断されました。再試行してください。",
  "08003": () => "データベース接続が切断されました。再試行してください。",
  "08001": () => "データベース接続が切断されました。再試行してください。",
};

/** SQLSTATE 形式 (5 文字数字英大文字) の判定。SQLSTATE_MESSAGES マッピングを適用する条件。 */
const SQLSTATE_PATTERN = /^[0-9A-Z]{5}$/;

/**
 * `ParsedPgError` (または null) を UI 表示用の日本語メッセージに整形する。
 * - SQLSTATE 形式 + 既知 code → 専用文言 (例: 23503 → 関連レコード文言)。
 * - SQLSTATE 形式 + 未知 code → `[code] message` のフォールバック。
 * - 非 SQLSTATE 形式 (例: `UNSAFE_TRANSACTION` / `ECONNREFUSED`) → 同じく
 *   `[code] message` のフォールバック (内部スキーマ情報ではなくエラー種別の文字列なので
 *   UI 表示しても二系統設計に反しない)。
 * - parsed が null → `fallback` をそのまま返す。
 */
export function formatUserMessage(
  parsed: ParsedPgError | null,
  fallback: string,
): string {
  if (!parsed) return fallback;
  if (SQLSTATE_PATTERN.test(parsed.code)) {
    const formatter = SQLSTATE_MESSAGES[parsed.code];
    if (formatter) return formatter(parsed);
  }
  const body = parsed.message || fallback;
  return `[${parsed.code}] ${body}`;
}
