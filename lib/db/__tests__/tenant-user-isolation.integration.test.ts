/** ユーザー領域の全メソッドを実Postgresで検査する (#368 / #369)。 */
import { describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { db, type DbClient, type Tx } from "@/lib/db/client";
import { makeProfileRepo } from "@/lib/db/profile-repository";
import { makeMembershipRepo } from "@/lib/db/membership-repository";
import { makeNotificationRepo } from "@/lib/db/notification-repository";
import { makePromptTemplateRepo } from "@/lib/db/prompt-template-repository";
import { makeAppSettingsRepo } from "@/lib/db/app-settings-repository";
import { makeEventLogRepo } from "@/lib/db/event-log-repository";
import { tenants, memberships, profiles, notifications, aiPromptTemplates, appSettings, eventLogs } from "@/lib/db/schema";
import type { AiPromptTemplateInput } from "@/types/ai-prompt-template";
import type { EventLogInsert } from "@/lib/repositories/event-log-repository";

const A = "f3681000-0000-4000-8000-000000000001", B = "f3681000-0000-4000-8000-000000000002";
const UA = "f3681000-0000-4000-8000-00000000000a", UB = "f3681000-0000-4000-8000-00000000000b";
const SHARED = "f3681000-0000-4000-8000-00000000000c", PLACEHOLDER = "f3681000-0000-4000-8000-00000000000d";
const TA = "f3681000-0000-4000-8000-00000000001a", TB = "f3681000-0000-4000-8000-00000000001b";
const NA = "notif_user_a", NB = "notif_user_b";
function bound(tx: Tx, tenant: string) {
  return { profile: makeProfileRepo(tx, tenant), membership: makeMembershipRepo(tx, tenant),
    notification: makeNotificationRepo(tx, tenant), promptTemplate: makePromptTemplateRepo(tx, tenant),
    appSettings: makeAppSettingsRepo(tx, tenant), eventLog: makeEventLogRepo(tx as unknown as DbClient, tenant) };
}
type UserRepos = ReturnType<typeof bound>;
interface Fixture { tx: Tx; repo: UserRepos; other: UserRepos }
async function fixture(work: (f: Fixture) => Promise<void>) {
  const rollback = new Error("rollback user fixture");
  await expect(db.transaction(async (tx) => {
    await tx.insert(tenants).values([A, B].map((id, i) => ({ id, slug: `user-368-${i}`, name: id, created_at: "2026-10-24", updated_at: "2026-10-24" })));
    for (const table of ["notifications", "ai_prompt_templates", "app_settings", "event_logs"]) {
      await tx.execute(sql.raw(`alter table ${table} alter column tenant_id drop default`));
    }
    for (const [id, name] of [[UA, "A only"], [UB, "B only"], [SHARED, "Shared"], [PLACEHOLDER, "Placeholder"]]) {
      await tx.execute(sql`insert into auth.users(id,email,raw_user_meta_data) values (${id},${`${id}@example.test`},jsonb_build_object('display_name', ${name}::text))`);
      await tx.update(profiles).set({ display_name: name }).where(eq(profiles.id, id!));
    }
    await tx.insert(memberships).values([
      { tenant_id: A, user_id: UA, role: "admin", created_at: "2026-10-24", updated_at: "2026-10-24" },
      { tenant_id: A, user_id: SHARED, role: "member", created_at: "2026-10-24", updated_at: "2026-10-24" },
      { tenant_id: A, user_id: PLACEHOLDER, role: "placeholder", created_at: "2026-10-24", updated_at: "2026-10-24" },
      { tenant_id: B, user_id: UB, role: "admin", created_at: "2026-10-24", updated_at: "2026-10-24" },
      { tenant_id: B, user_id: SHARED, role: "admin", created_at: "2026-10-24", updated_at: "2026-10-24" },
    ]);
    for (const [tenant, nid, templateId, suffix] of [[A, NA, TA, "a"], [B, NB, TB, "b"]] as const) {
      await tx.insert(notifications).values([
        { tenant_id: tenant, id: nid, user_id: SHARED, kind: "research_job_failed", title: suffix, body: "body", created_at: "2026-10-24", updated_at: "2026-10-24" },
        { tenant_id: tenant, id: `${nid}_read`, user_id: SHARED, kind: "research_job_failed", title: suffix, body: "body", read_at: "2026-10-24", created_at: "2026-10-23", updated_at: "2026-10-24" },
      ]);
      await tx.insert(aiPromptTemplates).values({ tenant_id: tenant, id: templateId, user_id: SHARED, name: suffix, body: "body", is_default: tenant === A, created_at: "2026-10-24", updated_at: "2026-10-24" });
      await tx.insert(appSettings).values({ tenant_id: tenant, key: `setting-${suffix}`, value: suffix, updated_at: "2026-10-24" });
    }
    const snapshot = async () => ({
      members: await tx.select().from(memberships).where(eq(memberships.tenant_id, B)).orderBy(memberships.user_id),
      notifications: await tx.select().from(notifications).where(eq(notifications.tenant_id, B)).orderBy(notifications.id),
      templates: await tx.select().from(aiPromptTemplates).where(eq(aiPromptTemplates.tenant_id, B)).orderBy(aiPromptTemplates.id),
      settings: await tx.select().from(appSettings).where(eq(appSettings.tenant_id, B)).orderBy(appSettings.key),
      logs: await tx.select().from(eventLogs).where(eq(eventLogs.tenant_id, B)).orderBy(eventLogs.id),
    });
    const before = await snapshot();
    await work({ tx, repo: bound(tx, A), other: bound(tx, B) });
    expect(await snapshot()).toEqual(before);
    throw rollback;
  })).rejects.toBe(rollback);
}
type Case = (f: Fixture) => Promise<void>;
type CaseMap = { [D in keyof UserRepos]: Record<keyof UserRepos[D], Case> };
const cases = {
  profile: {
    findById: async ({ repo }) => {
      for (const id of [UB, "f3681000-0000-4000-8000-000000000099"]) expect(await repo.profile.findById(id)).toBeNull();
      expect(await repo.profile.findById(UA)).toMatchObject({ id: UA });
      expect(await repo.profile.findById(SHARED)).toMatchObject({ id: SHARED });
    },
    findByEmail: async ({ repo }) => {
      expect(await repo.profile.findByEmail(`${UB}@example.test`)).toBeNull();
      expect(await repo.profile.findByEmail(`${UA}@example.test`)).toMatchObject({ id: UA });
    },
    findByDisplayName: async ({ repo }) => {
      expect(await repo.profile.findByDisplayName("B only")).toBeNull();
      expect(await repo.profile.findByDisplayName("A only")).toMatchObject({ id: UA });
    },
    findManyByIds: async ({ repo }) => {
      expect((await repo.profile.findManyByIds([UA, UB, SHARED])).map(p => p.id).sort()).toEqual([UA, SHARED].sort());
      expect(await repo.profile.findManyByIds([])).toEqual([]);
    },
    findAll: async ({ repo }) => { expect((await repo.profile.findAll()).map(p => p.id).sort()).toEqual([UA, SHARED, PLACEHOLDER].sort()); },
  },
  membership: {
    find: async ({ repo, other }) => {
      expect(await repo.membership.find(UB)).toBeNull();
      expect(await repo.membership.find(SHARED)).toMatchObject({ role: "member" });
      expect(await other.membership.find(SHARED)).toMatchObject({ role: "admin" });
    },
    list: async ({ repo }) => {
      expect((await repo.membership.list()).map(p => p.id).sort()).toEqual([UA, SHARED, PLACEHOLDER].sort());
      expect((await repo.membership.list({ excludePlaceholders: true })).map(p => p.id).sort()).toEqual([UA, SHARED].sort());
    },
    countAdmins: async ({ repo, other }) => {
      expect(await repo.membership.countAdmins()).toBe(1); expect(await other.membership.countAdmins()).toBe(2);
    },
    updateRole: async ({ repo, other }) => {
      expect(await repo.membership.updateRole(UB, "member")).toBeNull();
      expect(await repo.membership.updateRole(SHARED, "placeholder")).toMatchObject({ role: "placeholder" });
      expect(await other.membership.find(SHARED)).toMatchObject({ role: "admin" });
    },
  },
  notification: {
    findByUserId: async ({ repo }) => {
      expect((await repo.notification.findByUserId(SHARED)).map(n => n.id)).toEqual([NA, `${NA}_read`]);
      expect((await repo.notification.findByUserId(SHARED, { unreadOnly: true })).map(n => n.id)).toEqual([NA]);
      expect(await repo.notification.findByUserId(UB)).toEqual([]);
    },
    markAsRead: async ({ repo }) => {
      for (const id of [NB, "missing"]) expect(await repo.notification.markAsRead(id, SHARED)).toBe(false);
      expect(await repo.notification.markAsRead(NA, UA)).toBe(false);
      expect(await repo.notification.markAsRead(NA, SHARED)).toBe(true);
    },
    markAllAsRead: async ({ repo }) => {
      expect(await repo.notification.markAllAsRead(SHARED)).toBe(1);
      expect(await repo.notification.markAllAsRead(SHARED)).toBe(0);
    },
    insert: async ({ tx, repo }) => {
      const data = { user_id: SHARED, kind: "research_job_failed" as const, title: "own", body: "body", link_url: null };
      const created = await repo.notification.insert({ ...data, tenant_id: B } as typeof data);
      const [row] = await tx.select().from(notifications).where(eq(notifications.id, created.id));
      expect(row).toMatchObject({ tenant_id: A, user_id: SHARED });
      await expect(repo.notification.insert({ ...data, user_id: UB })).rejects.toThrow("ユーザーが見つかりません");
    },
  },
  promptTemplate: {
    list: async ({ repo }) => { expect((await repo.promptTemplate.list(SHARED)).map(t => t.id)).toEqual([TA]); },
    findById: async ({ repo }) => {
      for (const id of [TB, "f3681000-0000-4000-8000-000000000099"]) expect(await repo.promptTemplate.findById(id, SHARED)).toBeNull();
      expect(await repo.promptTemplate.findById(TA, UA)).toBeNull();
      expect(await repo.promptTemplate.findById(TA, SHARED)).toMatchObject({ id: TA });
    },
    countByUser: async ({ repo }) => { expect(await repo.promptTemplate.countByUser(SHARED)).toBe(1); },
    insert: async ({ tx, repo }) => {
      const data = { user_id: SHARED, name: "own", body: "body", is_default: false };
      const created = await repo.promptTemplate.insert({ ...data, tenant_id: B } as typeof data);
      const [row] = await tx.select().from(aiPromptTemplates).where(eq(aiPromptTemplates.id, created.id));
      expect(row).toMatchObject({ tenant_id: A, user_id: SHARED });
      await expect(repo.promptTemplate.insert({ ...data, user_id: UB })).rejects.toThrow("ユーザーが見つかりません");
    },
    update: async ({ repo }) => {
      expect(await repo.promptTemplate.update(TB, SHARED, { name: "other" })).toBeNull();
      expect(await repo.promptTemplate.update(TA, UA, { name: "other" })).toBeNull();
      expect(await repo.promptTemplate.update(TA, SHARED, { name: "own", tenant_id: B, user_id: UB, id: TB } as Partial<AiPromptTemplateInput>)).toMatchObject({ id: TA, user_id: SHARED, name: "own" });
    },
    delete: async ({ repo }) => {
      expect(await repo.promptTemplate.delete(TB, SHARED)).toBe(false);
      await repo.promptTemplate.clearDefaultForUser(SHARED);
      expect(await repo.promptTemplate.delete(TA, UA)).toBe(false);
      expect(await repo.promptTemplate.delete(TA, SHARED)).toBe(true);
    },
    clearDefaultForUser: async ({ repo }) => {
      await repo.promptTemplate.clearDefaultForUser(SHARED);
      expect(await repo.promptTemplate.findById(TA, SHARED)).toMatchObject({ is_default: false });
    },
    setDefault: async ({ repo }) => {
      expect(await repo.promptTemplate.setDefault(TB, SHARED)).toBeNull();
      expect(await repo.promptTemplate.setDefault(TA, UA)).toBeNull();
      await repo.promptTemplate.clearDefaultForUser(SHARED);
      expect(await repo.promptTemplate.setDefault(TA, SHARED)).toMatchObject({ id: TA, is_default: true });
    },
  },
  appSettings: {
    get: async ({ repo }) => {
      expect(await repo.appSettings.get("setting-b")).toBeNull(); expect(await repo.appSettings.get("missing")).toBeNull();
      expect(await repo.appSettings.get("setting-a")).toBe("a");
    },
    set: async ({ repo, tx }) => {
      await repo.appSettings.set("setting-a", "updated"); expect(await repo.appSettings.get("setting-a")).toBe("updated");
      await repo.appSettings.set("setting-new", "new"); expect(await repo.appSettings.get("setting-new")).toBe("new");
      // expand期間は旧global PKが拒否する。DBエラーはsavepoint内に閉じる。
      await expect(tx.transaction(inner => makeAppSettingsRepo(inner, A).set("setting-b", "overwrite"))).rejects.toThrow("設定を保存できませんでした");
    },
  },
  eventLog: {
    insert: async ({ tx, repo }) => {
      await repo.eventLog.insert({ id: "evt_user_test", event: "stores.delete", level: "info", kind: "mutation", target_id: "deleted-store", target_type: "store", payload: { deletionSucceeded: true }, actor_user_id: UB, tenant_id: B } as EventLogInsert);
      expect(await tx.select().from(eventLogs).where(eq(eventLogs.id, "evt_user_test"))).toEqual([expect.objectContaining({ tenant_id: A, actor_user_id: UB })]);
    },
  },
} satisfies CaseMap;

describe("ユーザーrepository全メソッドのテナント分離", () => {
  it("対象表が空でなく、実repositoryの全メソッドを含む", async () => fixture(async ({ repo }) => {
    expect(Object.keys(cases).length).toBeGreaterThan(0);
    expect(Object.keys(cases).sort()).toEqual(Object.keys(repo).sort());
    for (const domain of Object.keys(repo) as (keyof UserRepos)[]) {
      expect(Object.keys(cases[domain]).length).toBeGreaterThan(0);
      expect(Object.keys(cases[domain]).sort()).toEqual(Object.keys(repo[domain]).sort());
    }
  }));
  for (const [domain, methods] of Object.entries(cases)) {
    it.each(Object.entries(methods))(`${domain}.%s`, async (_, run) => fixture(run));
  }
  it("Bに既定がある兼務者の切替はglobal unique変更前でもBを解除しない", async () => fixture(async ({ tx, repo }) => {
    await repo.promptTemplate.clearDefaultForUser(SHARED);
    // fixture設定のみ。A/Bともdefault=trueは現行global indexが拒否する (#371)。
    await tx.update(aiPromptTemplates).set({ is_default: true }).where(eq(aiPromptTemplates.id, TB));
    await expect(tx.transaction(async (savepoint) => {
      await makePromptTemplateRepo(savepoint, A).setDefault(TA, SHARED);
    })).rejects.toThrow();
    expect(await repo.promptTemplate.findById(TA, SHARED)).toMatchObject({ is_default: false });
    expect((await tx.select().from(aiPromptTemplates).where(eq(aiPromptTemplates.id, TB)))[0]).toMatchObject({ is_default: true });
    // fixture前後のB不変比較の基準へ戻す。
    await tx.update(aiPromptTemplates).set({ is_default: false }).where(eq(aiPromptTemplates.id, TB));
  }));
});
