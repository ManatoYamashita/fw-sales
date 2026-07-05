/**
 * profiles.role を更新する運用スクリプト (#155 destructive-action-authz)。
 *
 * admin bootstrap 用。破壊的操作 (店舗削除・全データ削除等) は admin ロールのみ
 * 実行できるため、初回は本スクリプトで運用者アカウントを admin に昇格する。
 *
 * 使い方:
 *   pnpm db:set-role --email=<user@example.com> --role=admin
 *   pnpm db:set-role --email=<user@example.com> --role=member   (降格)
 *
 * 設計 (verify-store-cascade-fks.mjs と同形):
 * - Node の postgres クライアント (prepare:false)。psql(libpq) は DATABASE_URL 中の
 *   特殊文字を host と誤読するため使わない。
 * - DATABASE_URL は環境変数から取得し、値をログに一切出力しない。
 * - before/after の行を表示し、0 件一致なら exit 1 (email 打ち間違い防御)。
 * - role は member / admin / placeholder のみ許可。
 *
 * 注意: 本番 DB へ直接 UPDATE を行う。実行は要承認。
 */
import postgres from "postgres";

const VALID_ROLES = ["member", "admin", "placeholder"];

function parseArgs(argv) {
  const out = {};
  for (const arg of argv) {
    const m = arg.match(/^--(email|role)=(.+)$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

const { email, role } = parseArgs(process.argv.slice(2));

if (!email || !role) {
  console.error("Usage: pnpm db:set-role --email=<addr> --role=<member|admin|placeholder>");
  process.exit(1);
}
if (!VALID_ROLES.includes(role)) {
  console.error(`ERROR: role must be one of ${VALID_ROLES.join(" / ")} (got: ${role})`);
  process.exit(1);
}

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("ERROR: DATABASE_URL is not set.");
  process.exit(1);
}

const sql = postgres(url, {
  prepare: false,
  max: 1,
  idle_timeout: 5,
  connect_timeout: 10,
});

const today = new Date().toISOString().slice(0, 10);

try {
  const before = await sql`
    select id, email, display_name, role from profiles where email = ${email}`;
  if (before.length === 0) {
    console.error(`NG: email に一致する profile が存在しません: ${email}`);
    await sql.end({ timeout: 5 });
    process.exit(1);
  }
  console.log("before:", before.map((r) => ({ email: r.email, role: r.role })));

  const updated = await sql`
    update profiles set role = ${role}, updated_at = ${today}
    where email = ${email}
    returning id, email, display_name, role`;

  console.log("after: ", updated.map((r) => ({ email: r.email, role: r.role })));
  console.log(`OK: ${updated.length} 件の profile を role=${role} に更新しました。`);
  await sql.end({ timeout: 5 });
} catch (err) {
  console.error("SET-ROLE FAILED:", err instanceof Error ? err.message : String(err));
  await sql.end({ timeout: 5 }).catch(() => {});
  process.exit(1);
}
