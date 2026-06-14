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
 * `err` から PostgresError 互換オブジェクトを探す。Drizzle wrapper を含む
 * `cause` チェーンを最大 5 段までさかのぼり、最初に見つかった一つを返す。
 */
function unwrapToPostgresError(
  err: unknown,
): (Record<string, unknown> & { code: string }) | null {
  let current: unknown = err;
  for (let depth = 0; depth < 5; depth++) {
    if (!isRecord(current)) return null;
    if (
      current.name === "PostgresError" &&
      typeof current.code === "string" &&
      current.code !== ""
    ) {
      return current as Record<string, unknown> & { code: string };
    }
    current = current.cause;
  }
  return null;
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
  "23503": (p) => {
    const c = p.constraint ? ` (制約: ${p.constraint})` : "";
    return `関連レコードに紐づいているため削除できませんでした${c}。スキーマの ON DELETE 設定を確認してください。`;
  },
  // unique_violation
  "23505": (p) => {
    const c = p.constraint ? ` (制約: ${p.constraint})` : "";
    return `一意制約に違反しました${c}。`;
  },
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

/**
 * `ParsedPgError` (または null) を UI 表示用の日本語メッセージに整形する。
 * - 既知 SQLSTATE → 専用文言。
 * - 未知 SQLSTATE → `[code] message` のフォールバック。
 * - parsed が null → `fallback` をそのまま返す。
 */
export function formatUserMessage(
  parsed: ParsedPgError | null,
  fallback: string,
): string {
  if (!parsed) return fallback;
  const formatter = SQLSTATE_MESSAGES[parsed.code];
  if (formatter) return formatter(parsed);
  const body = parsed.message || fallback;
  return `[${parsed.code}] ${body}`;
}
