/**
 * `lib/db/postgres-error.ts` のユニットテスト。
 *
 * 検証ポイント:
 * - PostgresError 様オブジェクトから code / detail / constraint / table を抽出できる
 * - Drizzle wrapper の `cause` チェーン経由でも PostgresError を発見できる
 * - 非 PostgresError 入力は null を返す
 * - SQLSTATE → 日本語フレンドリーメッセージのマッピング
 * - 未知 SQLSTATE / null parsed のフォールバック挙動
 */

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { parsePostgresError, formatUserMessage } = await import(
  "../postgres-error"
);

function makeRawPgError(
  code: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return { name: "PostgresError", code, message: `pg ${code}`, ...extra };
}

describe("parsePostgresError", () => {
  it("PostgresError 様オブジェクトから主要フィールドを抽出する", () => {
    const raw = makeRawPgError("23503", {
      detail: "Key (id)=(s_1) is not present in table 'stores'",
      constraint_name: "deals_store_id_stores_id_fk",
      table_name: "deals",
      column_name: "store_id",
      schema_name: "public",
      severity_local: "ERROR",
    });
    const parsed = parsePostgresError(raw);
    expect(parsed).toEqual({
      code: "23503",
      message: "pg 23503",
      detail: "Key (id)=(s_1) is not present in table 'stores'",
      constraint: "deals_store_id_stores_id_fk",
      table: "deals",
      column: "store_id",
      schema: "public",
      severity: "ERROR",
    });
  });

  it("cause チェーンの奥にいる PostgresError を発見する", () => {
    const inner = makeRawPgError("57014");
    const wrapped = {
      name: "DrizzleQueryError",
      message: "Failed query: delete from stores where ...",
      cause: inner,
    };
    const parsed = parsePostgresError(wrapped);
    expect(parsed?.code).toBe("57014");
  });

  it("非 PostgresError 入力は null を返す", () => {
    expect(parsePostgresError(new Error("plain"))).toBeNull();
    expect(parsePostgresError("string")).toBeNull();
    expect(parsePostgresError(null)).toBeNull();
    expect(parsePostgresError(undefined)).toBeNull();
    // name は合っているが code が無いケース
    expect(parsePostgresError({ name: "PostgresError" })).toBeNull();
  });

  it("cause チェーンの最大段数 (5 段) を超えると null を返す", () => {
    let nested: Record<string, unknown> = makeRawPgError("57014");
    for (let i = 0; i < 6; i++) {
      nested = { name: "Wrapper", message: "level", cause: nested };
    }
    expect(parsePostgresError(nested)).toBeNull();
  });

  it("constraint_name フィールドが無ければ constraint プロパティを fallback として使う", () => {
    const raw = makeRawPgError("23505", { constraint: "stores_pkey" });
    const parsed = parsePostgresError(raw);
    expect(parsed?.constraint).toBe("stores_pkey");
  });
});

describe("formatUserMessage", () => {
  it("57014 (statement_timeout) → タイムアウト文言", () => {
    const msg = formatUserMessage(
      { code: "57014", message: "canceling statement due to ..." },
      "fallback",
    );
    expect(msg).toMatch(/タイムアウト/);
  });

  it("23503 (FK 違反) → 関連レコード文言。制約名は UI に出さない (容疑 A 対応)", () => {
    const msg = formatUserMessage(
      {
        code: "23503",
        message: "update or delete on table",
        constraint: "deals_store_id_fk",
      },
      "fallback",
    );
    expect(msg).toMatch(/関連レコード/);
    // UI には内部スキーマ情報 (制約名) を露出しない。constraint は console.error
    // 側に渡される構造化ログにのみ残す方針 (PR #144 セルフレビュー容疑 A 対応)。
    expect(msg).not.toContain("deals_store_id_fk");
  });

  it("23505 (UNIQUE 違反) → 一意制約文言。制約名は UI に出さない", () => {
    const msg = formatUserMessage(
      { code: "23505", message: "duplicate key", constraint: "stores_pkey" },
      "fallback",
    );
    expect(msg).toMatch(/一意制約/);
    expect(msg).not.toContain("stores_pkey");
  });

  it("42501 (権限不足) → 権限文言", () => {
    const msg = formatUserMessage(
      { code: "42501", message: "permission denied" },
      "fallback",
    );
    expect(msg).toMatch(/権限/);
  });

  it("08006 (接続切断) → 接続切断文言", () => {
    const msg = formatUserMessage(
      { code: "08006", message: "connection lost" },
      "fallback",
    );
    expect(msg).toMatch(/接続/);
  });

  it("未知 SQLSTATE は `[code] message` 書式でフォールバック", () => {
    const msg = formatUserMessage(
      { code: "99999", message: "weird error" },
      "fallback",
    );
    expect(msg).toBe("[99999] weird error");
  });

  it("未知 SQLSTATE で message が空なら fallback を本文に使う", () => {
    const msg = formatUserMessage(
      { code: "99999", message: "" },
      "店舗の削除に失敗しました",
    );
    expect(msg).toBe("[99999] 店舗の削除に失敗しました");
  });

  it("parsed が null なら fallback をそのまま返す", () => {
    expect(formatUserMessage(null, "店舗の削除に失敗しました")).toBe(
      "店舗の削除に失敗しました",
    );
  });
});
