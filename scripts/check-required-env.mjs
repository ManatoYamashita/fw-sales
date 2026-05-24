#!/usr/bin/env node
// 本番ビルド前に NEXT_PUBLIC_* / 必須 env vars の不在を検出して fail させる。
// Vercel で NEXT_PUBLIC_* が後付けされた既存デプロイが古いバンドル (値 undefined)
// のまま配信され続ける事故を防ぐためのプリチェック。

const REQUIRED = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "DATABASE_URL",
  "GEMINI_API_KEY",
  "NEXT_PUBLIC_APP_URL",
];

if (process.env.SKIP_ENV_CHECK === "1" || process.env.NODE_ENV === "test") {
  console.log("[check-env] skipped (SKIP_ENV_CHECK or NODE_ENV=test)");
  process.exit(0);
}

const missing = REQUIRED.filter((name) => {
  const value = process.env[name];
  return value === undefined || value === "";
});

const scope = process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "unknown";

if (missing.length > 0) {
  console.error(
    `[check-env] FAIL (scope=${scope}): missing required env vars -> ${missing.join(", ")}`,
  );
  console.error(
    "[check-env] Set them in Vercel Project Settings > Environment Variables, then redeploy.",
  );
  process.exit(1);
}

console.log(
  `[check-env] OK (scope=${scope}): all ${REQUIRED.length} required env vars present`,
);
