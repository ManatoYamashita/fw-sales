import { describe, expect, it } from "vitest";
import {
  buildLocalPreviewEnv,
  getLocalPreviewConfig,
  LOCAL_USER_ID,
} from "../local-preview.mjs";

describe("ローカル検証環境の接続先分離", () => {
  it("本番設定を継承していてもDB・Auth・外部APIの接続情報を上書きする", () => {
    const inherited = {
      PATH: "/test/bin",
      DATABASE_URL: "postgres://prod:secret@db.production.supabase.co/postgres",
      NEXT_PUBLIC_SUPABASE_URL: "https://production.supabase.co",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "production-anon",
      SUPABASE_SERVICE_ROLE_KEY: "production-service-role",
      GEMINI_API_KEY: "production-gemini",
      GOOGLE_PLACES_API_KEY: "production-places",
      NEXT_PUBLIC_GOOGLE_MAPS_API_KEY: "production-maps",
      GOOGLE_OAUTH_CLIENT_ID: "production-google-client",
      GOOGLE_OAUTH_CLIENT_SECRET: "production-google-secret",
      VERCEL_OIDC_TOKEN: "production-oidc",
      CRON_SECRET: "production-cron",
      NODE_ENV: "production",
      VERCEL: "1",
      VERCEL_ENV: "production",
      E2E_TEST_USER_ID: "inherited-user",
      E2E_TEST_SECRET: "inherited-secret",
    };
    const databaseUrl = "postgres://postgres:postgres@192.168.64.99:5432/postgres";
    const env = buildLocalPreviewEnv(databaseUrl, getLocalPreviewConfig({}), "local-secret", inherited);

    expect(env.DATABASE_URL).toBe(databaseUrl);
    expect(env.NEXT_PUBLIC_SUPABASE_URL).toBe("http://127.0.0.1:54321");
    expect(env.NEXT_PUBLIC_SUPABASE_ANON_KEY).toBe("local-not-used");
    expect(env.SUPABASE_SERVICE_ROLE_KEY).toBe("local-not-used");
    for (const key of [
      "GEMINI_API_KEY", "GOOGLE_PLACES_API_KEY", "NEXT_PUBLIC_GOOGLE_MAPS_API_KEY",
      "GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_SECRET", "VERCEL_OIDC_TOKEN", "CRON_SECRET",
    ] as const) expect(env[key]).toBe("");
    expect(env.NODE_ENV).toBe("development");
    expect(env.VERCEL).toBe("");
    expect(env.VERCEL_ENV).toBe("development");
    expect(env.E2E_TEST_USER_ID).toBe(LOCAL_USER_ID);
    expect(env.E2E_TEST_SECRET).toBe("local-secret");
    expect(env.PATH).toBe("/test/bin");
    expect(inherited.DATABASE_URL).toContain("production.supabase.co");
  });

  it("検証サーバーのURLは127.0.0.1に固定し、指定ポートのみ反映する", () => {
    expect(getLocalPreviewConfig({ LOCAL_PREVIEW_PORT: "3210" })).toMatchObject({
      port: 3210, baseUrl: "http://127.0.0.1:3210",
    });
  });

  it.each(["0", "80", "65536", "3200abc", "", "3200.5"])("不正ポート %s は起動前に拒否する", (port) => {
    expect(() => getLocalPreviewConfig({ LOCAL_PREVIEW_PORT: port })).toThrow("LOCAL_PREVIEW_PORT");
  });
});
