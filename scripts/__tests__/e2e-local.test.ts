/**
 * E2E用PostgreSQLのコンテナ名を環境変数で切り替えられること。
 *
 * `pnpm e2e` は起動のたびに同名のコンテナを `delete --force` で作り直す。名前が固定だと
 * 別の作業ツリーで実行中のE2EのDBを消してしまうため、`E2E_DB_CONTAINER` で分けられる
 * ようにした。ここでは名前の解決と、起動・削除・IP取得のすべてが同じ名前を使うことを確かめる。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const execFileSync = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({ execFileSync, spawn: vi.fn() }));

const {
  E2E_TEST_USER_ID,
  DEFAULT_E2E_DB_CONTAINER_NAME,
  getE2eDatabaseEnv,
  getE2eDbContainerName,
  startE2eDatabase,
} = await import("../e2e-local.mjs");
const { serializeAuditInput } = await import("../../lib/observability/serialize");
const { AUDIT_EVENTS } = await import("../../lib/observability/events");

describe("E2E_TEST_USER_ID (#346)", () => {
  // E2E で操作したときの監査ログは、この ID を actor にする。検証を通らないと、
  // 操作は成功したまま監査の書き込みだけが失敗し、E2E も緑のままになる。
  it("監査ログの actor の検証を通る", () => {
    expect(() =>
      serializeAuditInput({
        event: AUDIT_EVENTS.storeDelete,
        actor: { userId: E2E_TEST_USER_ID, email: "e2e@example.test" },
        storeId: "store_001",
        payload: { deletionSucceeded: true },
      }),
    ).not.toThrow();
  });
});

describe("getE2eDbContainerName", () => {
  it("未指定なら既定の名前を使う", () => {
    expect(getE2eDbContainerName({})).toBe("fw-sales-e2e-postgres");
    expect(getE2eDbContainerName({ E2E_DB_CONTAINER: "   " })).toBe(DEFAULT_E2E_DB_CONTAINER_NAME);
  });

  it("E2E_DB_CONTAINER を前後の空白を除いて使う", () => {
    expect(getE2eDbContainerName({ E2E_DB_CONTAINER: " fw-sales-e2e-postgres-297 " })).toBe(
      "fw-sales-e2e-postgres-297",
    );
    expect(getE2eDbContainerName({ E2E_DB_CONTAINER: "e2e_db.2" })).toBe("e2e_db.2");
  });

  it.each([
    ["オプションに見える名前", "--rm"],
    ["空白を含む名前", "e2e db"],
    ["シェルの区切り文字", "e2e;rm"],
    ["英数字以外で始まる名前", ".e2e"],
    ["64 文字以上", "a".repeat(64)],
  ])("%s は拒否する", (_label, value) => {
    expect(() => getE2eDbContainerName({ E2E_DB_CONTAINER: value })).toThrow(/E2E_DB_CONTAINER/);
  });

  it("63 文字までは受け付ける", () => {
    expect(getE2eDbContainerName({ E2E_DB_CONTAINER: "a".repeat(63) })).toBe("a".repeat(63));
  });
});

describe("コンテナ操作が指定した名前を使う", () => {
  const savedEnv = { ...process.env };
  let binDir: string;

  beforeEach(() => {
    execFileSync.mockReset();
    // commandExists("container") を満たす実行可能ファイルだけを置いた PATH を用意する
    binDir = fs.mkdtempSync(path.join(os.tmpdir(), "e2e-local-test-"));
    const fake = path.join(binDir, "container");
    fs.writeFileSync(fake, "#!/bin/sh\n");
    fs.chmodSync(fake, 0o755);
    process.env.PATH = binDir;
    delete process.env.E2E_DATABASE_URL;
    execFileSync.mockImplementation((_cmd: string, args: string[]) =>
      args[0] === "list"
        ? JSON.stringify([
            { id: "fw-sales-e2e-postgres", status: { networks: [{ ipv4Address: "192.168.64.2/24" }] } },
            { id: "fw-sales-e2e-postgres-297", status: { networks: [{ ipv4Address: "192.168.64.9/24" }] } },
          ])
        : "",
    );
  });

  afterEach(() => {
    process.env = { ...savedEnv };
    fs.rmSync(binDir, { recursive: true, force: true });
  });

  it("E2E_DB_CONTAINER の名前だけを削除・起動し、その IP へ接続する", () => {
    process.env.E2E_DB_CONTAINER = "fw-sales-e2e-postgres-297";

    const env = startE2eDatabase();

    const calls = execFileSync.mock.calls.map(([, args]) => args as string[]);
    expect(calls).toContainEqual(["delete", "--force", "fw-sales-e2e-postgres-297"]);
    const run = calls.find((args) => args[0] === "run")!;
    expect(run[run.indexOf("--name") + 1]).toBe("fw-sales-e2e-postgres-297");
    // 既定名のコンテナ (別の作業ツリーが使用中) には一切触れない
    expect(calls.flat()).not.toContain("fw-sales-e2e-postgres");
    expect(env.DATABASE_URL).toBe("postgres://postgres:postgres@192.168.64.9:5432/postgres");
  });

  it("未指定なら既定名のコンテナへ接続する (従来どおり)", () => {
    delete process.env.E2E_DB_CONTAINER;
    expect(getE2eDatabaseEnv().DATABASE_URL).toBe(
      "postgres://postgres:postgres@192.168.64.2:5432/postgres",
    );
  });

  it("対象コンテナが無ければ名前を添えて失敗する", () => {
    process.env.E2E_DB_CONTAINER = "fw-sales-e2e-postgres-missing";
    expect(() => getE2eDatabaseEnv()).toThrow("fw-sales-e2e-postgres-missing");
  });
});
