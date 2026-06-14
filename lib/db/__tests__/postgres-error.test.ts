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

  // PR #N (PR #144 の本番症状) で追加した 2 段検出のテスト群。
  // postgres-js の generic(code, message) は name を未設定 (= "Error") のまま code を
  // 持つ。Drizzle DrizzleQueryError も name 未設定で、cause に generic error を載せて
  // 投げる。これらを 1 段目 (name === "PostgresError") では拾えないため、2 段目で code
  // フィールドの存在をもって ParsedPgError として扱う。
  it("name が PostgresError でなくても code を持つエラーを 2 段目で検出する (generic UNSAFE_TRANSACTION)", () => {
    const generic = Object.assign(new Error("UNSAFE_TRANSACTION: ..."), {
      code: "UNSAFE_TRANSACTION",
    });
    const parsed = parsePostgresError(generic);
    expect(parsed?.code).toBe("UNSAFE_TRANSACTION");
  });

  it("cause チェーン内の generic error も 2 段目で検出する (Drizzle wrapper 想定)", () => {
    const generic = Object.assign(new Error("UNSAFE_TRANSACTION: ..."), {
      code: "UNSAFE_TRANSACTION",
    });
    const wrapped: Error & { cause?: unknown } = Object.assign(
      new Error("Failed query: delete from stores where ..."),
      { cause: generic },
    );
    const parsed = parsePostgresError(wrapped);
    expect(parsed?.code).toBe("UNSAFE_TRANSACTION");
  });

  it("PostgresError は generic より優先される (1 段目優先)", () => {
    // 浅い depth に generic、深い depth に PostgresError がある場合、真のサーバー
    // エラーを優先して返す。
    const pgError = makeRawPgError("23503", { detail: "fk violation" });
    const generic = Object.assign(new Error("UNSAFE: ..."), {
      code: "UNSAFE_TRANSACTION",
      cause: pgError,
    });
    const parsed = parsePostgresError(generic);
    expect(parsed?.code).toBe("23503");
    expect(parsed?.detail).toBe("fk violation");
  });

  it("connection error 風 (ECONNREFUSED) も検出する", () => {
    const conn = Object.assign(new Error("write ECONNREFUSED ..."), {
      code: "ECONNREFUSED",
      errno: "ECONNREFUSED",
    });
    const parsed = parsePostgresError(conn);
    expect(parsed?.code).toBe("ECONNREFUSED");
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

  // 2 段検出 (PR #N) で SQLSTATE 形式以外の code (例: UNSAFE_TRANSACTION / ECONNREFUSED)
  // を持つエラーが ParsedPgError として渡るようになったため、formatUserMessage は
  // SQLSTATE 形式 (5 文字数字英大文字) でない code を [code] message フォールバックで
  // 整形する。SQLSTATE_MESSAGES のキー一致だけに頼らず、形式判定で誤マッピングも防ぐ。
  it("非 SQLSTATE 形式 (UNSAFE_TRANSACTION) は [code] message フォールバック", () => {
    const msg = formatUserMessage(
      {
        code: "UNSAFE_TRANSACTION",
        message: "UNSAFE_TRANSACTION: SET LOCAL is not safe ...",
      },
      "fallback",
    );
    expect(msg).toBe(
      "[UNSAFE_TRANSACTION] UNSAFE_TRANSACTION: SET LOCAL is not safe ...",
    );
  });

  it("非 SQLSTATE 形式 (ECONNREFUSED) も [code] message フォールバック", () => {
    const msg = formatUserMessage(
      { code: "ECONNREFUSED", message: "write ECONNREFUSED ..." },
      "fallback",
    );
    expect(msg).toBe("[ECONNREFUSED] write ECONNREFUSED ...");
    expect(msg).not.toMatch(/関連レコード/);
  });
});
