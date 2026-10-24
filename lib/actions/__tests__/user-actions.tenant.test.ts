import { beforeEach, describe, expect, it, vi } from "vitest";
import { serializeFreeform } from "@/types/ai-prompt-template";
const mocks = vi.hoisted(() => ({
  forTenant: vi.fn(), profile: vi.fn(), tag: vi.fn(),
  read: vi.fn(), mark: vi.fn(), markAll: vi.fn(), list: vi.fn(), find: vi.fn(), update: vi.fn(),
  remove: vi.fn(), setDefault: vi.fn(), insert: vi.fn(), count: vi.fn(), transaction: vi.fn(),
}));
vi.mock("@/lib/tenant/context", () => ({ resolveTenantId: async () => "tenant-b" }));
vi.mock("@/lib/supabase/server", () => ({ getCurrentProfile: mocks.profile }));
vi.mock("@/lib/repositories", () => ({ repos: { forTenant: mocks.forTenant } }));
vi.mock("next/cache", () => ({ updateTag: mocks.tag }));
import { markNotificationReadAction, markAllNotificationsReadAction } from "@/lib/actions/notification-actions";
import { listPromptTemplatesAction, createPromptTemplateAction, updatePromptTemplateAction, deletePromptTemplateAction, setDefaultPromptTemplateAction } from "@/lib/actions/prompt-template-actions";
const ID = "f3681000-0000-4000-8000-00000000001a", MISSING = "f3681000-0000-4000-8000-000000000099";
function form(id = ID) {
  const data = new FormData(); data.set("id", id); data.set("name", "own"); data.set("body", serializeFreeform("own body")); return data;
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.profile.mockResolvedValue({ id: "shared-user", role: "admin" });
  mocks.forTenant.mockImplementation((tenantId) => {
    expect(tenantId).toBe("tenant-b");
    return { notification: { markAsRead: mocks.mark, markAllAsRead: mocks.markAll },
      promptTemplate: { list: mocks.list, findById: mocks.find, update: mocks.update }, transaction: mocks.transaction };
  });
  mocks.mark.mockResolvedValue(false); mocks.markAll.mockResolvedValue(2); mocks.list.mockResolvedValue([]);
  mocks.find.mockResolvedValue(null); mocks.update.mockResolvedValue(null);
  mocks.transaction.mockImplementation(async (work) => work({ promptTemplate: { countByUser: mocks.count, insert: mocks.insert, setDefault: mocks.setDefault } }));
  mocks.count.mockResolvedValue(0); mocks.insert.mockResolvedValue({ id: ID });
});
describe("ユーザーActionのテナント引き継ぎ", () => {
  it("通知の個別・一括既読は現在の所属と本人に限定し、Bのタグだけを失効する", async () => {
    expect(await markNotificationReadAction("foreign-id")).toEqual(await markNotificationReadAction("missing-id"));
    expect(mocks.mark).toHaveBeenCalledWith("foreign-id", "shared-user"); expect(mocks.tag).not.toHaveBeenCalled();
    expect(await markAllNotificationsReadAction()).toMatchObject({ ok: true, data: { count: 2 } });
    expect(mocks.markAll).toHaveBeenCalledWith("shared-user");
    expect(mocks.tag).toHaveBeenCalledExactlyOnceWith("tenant:tenant-b:notifications");
  });
  it("テンプレート一覧と新規作成の通常/transactionもBに束縛する", async () => {
    await listPromptTemplatesAction(); expect(mocks.list).toHaveBeenCalledWith("shared-user");
    expect(await createPromptTemplateAction(form())).toMatchObject({ ok: true });
    expect(mocks.insert).toHaveBeenCalledWith(expect.objectContaining({ user_id: "shared-user", is_default: true }));
    expect(mocks.tag).toHaveBeenCalledExactlyOnceWith("tenant:tenant-b:prompt-templates");
  });
  it.each([
    ["更新", (id: string) => updatePromptTemplateAction(form(id))],
    ["削除", deletePromptTemplateAction], ["既定切替", setDefaultPromptTemplateAction],
  ] as const)("他社テンプレートの%sは不存在と同じ応答で止まる", async (_, action) => {
    expect(await action(ID)).toEqual(await action(MISSING));
    expect(mocks.forTenant).toHaveBeenCalledWith("tenant-b");
    expect(mocks.transaction).not.toHaveBeenCalled(); expect(mocks.tag).not.toHaveBeenCalled();
  });
  it.each([
    ["一覧", listPromptTemplatesAction], ["作成", () => createPromptTemplateAction(form())],
    ["更新", () => updatePromptTemplateAction(form())], ["削除", () => deletePromptTemplateAction(ID)],
    ["既定切替", () => setDefaultPromptTemplateAction(ID)],
  ] as const)("現在の所属がなければ%sを拒否する", async (_, action) => {
    mocks.profile.mockResolvedValue(null);
    expect(await action()).toMatchObject({ ok: false });
    expect(mocks.forTenant).not.toHaveBeenCalled();
  });
});
