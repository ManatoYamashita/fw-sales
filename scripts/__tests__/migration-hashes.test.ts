import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { getMigrationHashes } from "../_migration-hashes.mjs";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");

describe("Drizzle migration来歴の改行差", () => {
  it("Windowsで適用したCRLFとCIのLFを同じSQLとして照合できる", () => {
    const lf = 'ALTER TABLE "stores" ADD COLUMN "memo" text;\n';
    const crlf = lf.replaceAll("\n", "\r\n");
    expect(getMigrationHashes(lf)).toContain(hash(crlf));
    expect(new Set(getMigrationHashes(lf))).toEqual(new Set(getMigrationHashes(crlf)));
  });
  it("SQLの変更や末尾改行の追加を改行コード差として扱わない", () => {
    const sql = "SELECT 1;\n";
    expect(getMigrationHashes(sql)).not.toContain(hash("SELECT 2;\n"));
    expect(getMigrationHashes(sql)).not.toContain(hash("SELECT 1;\n\n"));
    expect(getMigrationHashes(sql)).not.toContain(hash("SELECT 1;"));
  });
});
