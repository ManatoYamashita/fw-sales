/**
 * テナントでのロール (`memberships.role`) を更新する運用スクリプト (#155 destructive-action-authz)。
 *
 * admin bootstrap 用。破壊的操作 (店舗削除・全データ削除等) は admin ロールのみ
 * 実行できるため、初回は本スクリプトで運用者アカウントを admin に昇格する。
 * ロールは人ではなく所属の属性なので、`profiles.role` ではなく `memberships.role` を
 * 書き換える (マルチテナント化 #367。`profiles.role` は #376 で撤去する)。
 *
 * 使い方:
 *   pnpm db:set-role --tenant=firstweb --email=<user@example.com> --role=admin
 *   pnpm db:set-role --tenant=firstweb --email=<user@example.com> --role=member   (降格)
 *   pnpm db:set-role --tenant-id=<UUID> --email=<user@example.com> --role=admin
 *     (--tenant / --tenant-id は必須。既定値は持たない)
 *
 * 設計 (verify-store-cascade-fks.mjs と同形):
 * - Node の postgres クライアント (prepare:false)。psql(libpq) は DATABASE_URL 中の
 *   特殊文字を host と誤読するため使わない。
 * - DATABASE_URL は環境変数から取得し、値をログに一切出力しない。
 * - before/after の行を表示し、0 件一致なら exit 1 (email の打ち間違いと、所属の無い
 *   ユーザーの防御)。所属を新しく作ることはしない (招待制は #374)。
 * - role は member / admin / placeholder のみ許可。
 *
 * 本番運用ではAPP_ENV=prdと本番接続情報を明示し、対象アカウントを確認します。
 */
import postgres from "postgres";
import { parseTenantSelection, resolveScriptTenant } from "./_tenant-args.mjs";
import { assertDatabaseTarget } from "../lib/environment-isolation.mjs";

const VALID_ROLES = ["member", "admin", "placeholder"];

function parseArgs(argv) {
  const out = {};
  for (const arg of argv) {
    const m = arg.match(/^--(email|role|tenant)=(.+)$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

const selection = parseTenantSelection(process.argv.slice(2));
const { email, role } = parseArgs(process.argv.slice(2));

if (!email || !role) {
  console.error("Usage: pnpm db:set-role --email=<addr> --role=<member|admin|placeholder> --tenant=<slug>");
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

assertDatabaseTarget();

const sql = postgres(url, {
  prepare: false,
  max: 1,
  idle_timeout: 5,
  connect_timeout: 10,
});

const today = new Date().toISOString().slice(0, 10);

try {
  const tenant = await resolveScriptTenant(sql, selection);

  const before = await sql`
    select p.email, m.role
    from memberships m join profiles p on p.id = m.user_id
    where m.tenant_id = ${tenant.id} and p.email = ${email}`;
  if (before.length === 0) {
    console.error(`NG: テナント ${tenant.slug} に、email に一致する所属が存在しません: ${email}`);
    await sql.end({ timeout: 5 });
    process.exit(1);
  }
  console.log(`tenant: ${tenant.slug}`);
  console.log("before:", before.map((r) => ({ email: r.email, role: r.role })));

  const updated = await sql`
    update memberships m set role = ${role}, updated_at = ${today}
    from profiles p
    where p.id = m.user_id and m.tenant_id = ${tenant.id} and p.email = ${email}
    returning p.email, m.role`;

  console.log("after: ", updated.map((r) => ({ email: r.email, role: r.role })));
  console.log(`OK: ${updated.length} 件の所属を role=${role} に更新しました。`);
  await sql.end({ timeout: 5 });
} catch (err) {
  console.error("SET-ROLE FAILED:", err instanceof Error ? err.message : String(err));
  await sql.end({ timeout: 5 }).catch(() => {});
  process.exit(1);
}
