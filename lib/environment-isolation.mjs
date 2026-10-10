// Issue #46: DBとAuthの接続先を、環境名ではなくプロジェクト参照で検証します。
export const SUPABASE_PROJECTS = Object.freeze({
  dev: "llohmzwfqgcrvusxabcb",
  prd: "bqllbsiahnikgerckwoj",
});

/** @param {Record<string, string | undefined>} env */
function getScope(env) {
  const declared = env.APP_ENV?.trim();
  if (declared && !["local", "dev", "prd"].includes(declared)) {
    throw new Error("APP_ENV must be local, dev, or prd.");
  }
  if (env.VERCEL_ENV === "production") {
    if (declared && declared !== "prd") throw new Error("Production requires APP_ENV=prd.");
    return "prd";
  }
  if (env.VERCEL_ENV === "preview" || env.VERCEL_ENV === "development") {
    if (declared === "prd") throw new Error("Preview/Development cannot use APP_ENV=prd.");
  }
  // テスト認証は開発サーバーと専用ローカルDBの組合せに限定します。
  if (declared === "local" || (env.E2E_TEST_MODE === "1" && env.NODE_ENV === "development")) {
    if (env.VERCEL === "1" || env.NODE_ENV === "production") {
      throw new Error("Local test authentication cannot run on Vercel or a production server.");
    }
    return "local";
  }
  return declared ?? "dev";
}

/** @param {string | undefined} value @param {string} key */
function parseUrl(value, key) {
  try {
    if (!value?.trim()) throw new Error();
    return new URL(value.trim());
  } catch {
    // URLの値や解析エラーは接続パスワードを含む可能性があるため表示しません。
    throw new Error(`Invalid or missing ${key}.`);
  }
}

/** @param {string} host */
function isLocalHost(host) {
  if (["localhost", "127.0.0.1", "[::1]"].includes(host)) return true;
  const octets = host.split(".").map(Number);
  if (octets.length !== 4 || octets.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  return octets[0] === 10 || (octets[0] === 192 && octets[1] === 168)
    || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31);
}

/** @param {Record<string, string | undefined>} env */
export function assertDatabaseTarget(env = process.env) {
  const scope = getScope(env);
  const url = parseUrl(env.DATABASE_URL, "DATABASE_URL");
  if (!["postgres:", "postgresql:"].includes(url.protocol)) throw new Error("DATABASE_URL must use PostgreSQL.");
  if (scope === "local") {
    if (!isLocalHost(url.hostname)) throw new Error("Local verification requires a local PostgreSQL host.");
    return scope;
  }
  const expected = SUPABASE_PROJECTS[scope];
  let user;
  try { user = decodeURIComponent(url.username); }
  catch { throw new Error("Invalid DATABASE_URL username."); }
  const direct = url.hostname === `db.${expected}.supabase.co` && user === "postgres";
  const pooler = /^aws-\d+-[a-z0-9-]+\.pooler\.supabase\.com$/.test(url.hostname)
    && user === `postgres.${expected}`;
  if (!direct && !pooler) throw new Error(`DATABASE_URL does not match the ${scope} Supabase project.`);
  return scope;
}

/** @param {Record<string, string | undefined>} env */
export function assertEnvironmentIsolation(env = process.env) {
  const scope = assertDatabaseTarget(env);
  const auth = parseUrl(env.NEXT_PUBLIC_SUPABASE_URL, "NEXT_PUBLIC_SUPABASE_URL");
  if (scope === "local") {
    if (env.E2E_TEST_MODE !== "1" || !["localhost", "127.0.0.1", "[::1]"].includes(auth.hostname)) {
      throw new Error("Local verification requires local Auth and E2E_TEST_MODE=1.");
    }
    return scope;
  }
  const expected = SUPABASE_PROJECTS[scope];
  if (auth.protocol !== "https:" || auth.hostname !== `${expected}.supabase.co`) {
    throw new Error(`NEXT_PUBLIC_SUPABASE_URL does not match the ${scope} Supabase project.`);
  }
  for (const key of ["NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"]) {
    const value = env[key]?.trim();
    if (!value) throw new Error(`Missing required env: ${key}`);
    // Legacy JWTにはrefが含まれます。新形式のAPIキーはURLとクラウド設定で照合します。
    if (value.startsWith("eyJ")) {
      let claims;
      try { claims = JSON.parse(Buffer.from(value.split(".")[1], "base64url").toString("utf8")); }
      catch { throw new Error(`Invalid ${key}.`); }
      const role = key === "NEXT_PUBLIC_SUPABASE_ANON_KEY" ? "anon" : "service_role";
      if (claims.ref !== expected || claims.role !== role) throw new Error(`${key} does not match the ${scope} Supabase project/role.`);
    }
  }
  return scope;
}
