import { describe, expect, it } from "vitest";
import { assertDatabaseTarget, assertEnvironmentIsolation, SUPABASE_PROJECTS } from "../../lib/environment-isolation.mjs";

function environment(scope: "dev" | "prd") {
  const ref = SUPABASE_PROJECTS[scope];
  const jwt = (role: string) => `eyJheader.${Buffer.from(JSON.stringify({ ref, role })).toString("base64url")}.signature`;
  return {
    APP_ENV: scope,
    VERCEL_ENV: scope === "prd" ? "production" : "preview",
    NODE_ENV: "production",
    DATABASE_URL: `postgres://postgres.${ref}:secret@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres`,
    NEXT_PUBLIC_SUPABASE_URL: `https://${ref}.supabase.co`,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: jwt("anon"),
    SUPABASE_SERVICE_ROLE_KEY: jwt("service_role"),
  };
}

describe("環境間のDB・Auth誤接続ガード", () => {
  it.each(["dev", "prd"] as const)("%sのDB・Auth・JWTが一致する設定は許可する", scope => {
    expect(assertEnvironmentIsolation(environment(scope))).toBe(scope);
  });
  it("NODE_ENV=productionのPreviewもdevに限定する", () => {
    expect(assertEnvironmentIsolation({ ...environment("dev"), APP_ENV: undefined })).toBe("dev");
  });
  it.each(["DATABASE_URL", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"] as const)("devへの本番%s混入を拒否する", key => {
    expect(() => assertEnvironmentIsolation({ ...environment("dev"), [key]: environment("prd")[key] })).toThrow(key);
  });
  it("DevelopmentではAPP_ENV=prdによる本番接続の指定も拒否する", () => {
    expect(() => assertEnvironmentIsolation({ ...environment("prd"), VERCEL_ENV: "development" })).toThrow("APP_ENV");
  });
  it("Productionにdev指定が残った場合は拒否する", () => {
    expect(() => assertEnvironmentIsolation({ ...environment("dev"), VERCEL_ENV: "production" })).toThrow("APP_ENV");
  });
  it("通常のローカル開発はAPP_ENV未指定でも本番DBに接続できない", () => {
    expect(() => assertDatabaseTarget({ DATABASE_URL: environment("prd").DATABASE_URL })).toThrow("dev");
  });
  it("direct接続もdevのホストに限定する", () => {
    expect(assertDatabaseTarget({ DATABASE_URL: `postgresql://postgres:secret@db.${SUPABASE_PROJECTS.dev}.supabase.co/postgres` })).toBe("dev");
    expect(() => assertDatabaseTarget({ DATABASE_URL: `postgresql://postgres.${SUPABASE_PROJECTS.dev}:secret@example.com/postgres` })).toThrow("DATABASE_URL");
  });
  it("テスト認証モードでも本番DBをローカルDBと扱わない", () => {
    expect(() => assertEnvironmentIsolation({ ...environment("prd"), APP_ENV: "local", VERCEL_ENV: "development", NODE_ENV: "development", E2E_TEST_MODE: "1" })).toThrow("local PostgreSQL");
  });
  it("専用ローカルDBとテスト認証は利用できる", () => {
    expect(assertEnvironmentIsolation({ APP_ENV: "local", NODE_ENV: "development", E2E_TEST_MODE: "1", DATABASE_URL: "postgres://postgres:postgres@192.168.64.99/postgres", NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321" })).toBe("local");
  });
  it("不正URLを拒否するときに秘密情報をエラーへ含めない", () => {
    expect(() => assertDatabaseTarget({ DATABASE_URL: "secret-password" })).toThrow("Invalid or missing DATABASE_URL.");
  });
  it("Vercel上ではローカル認証モードを利用できない", () => {
    expect(() => assertEnvironmentIsolation({ APP_ENV: "local", VERCEL_ENV: "preview", VERCEL: "1", NODE_ENV: "development", E2E_TEST_MODE: "1" })).toThrow("Local test authentication");
  });
});
