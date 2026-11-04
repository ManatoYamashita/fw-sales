import { describe, expect, it } from "vitest";
import { EDITABLE_STORE_PATCH_FIELDS, parseStorePatch } from "@/lib/domain/store-patch";

const PROFILE_ID = "00000000-0000-4000-8000-000000000001";

/** 各画面が実際に送る patch (lib/domain/store-patch.ts の対応表)。 */
const SCREEN_PATCHES = {
  title: { name: "導楽", genre: "居酒屋" },
  basicInfo: {
    prefecture: "東京都",
    city: "目黒区",
    address: "中目黒1-5-8",
    genre: "イタリアン",
    channel: "DM推奨",
    has_contact_form: "あり",
    contact_email: " contract@example.com ",
    target_service: "HP,MEO",
    operator_type: "未設定",
    operator_name: "",
    assigned_planner_user_id: PROFILE_ID,
    assigned_sales_user_id: "",
  },
  map: { lat: 35.64, lng: 139.69 },
  mapCleared: { lat: null, lng: null },
  webAsset: { map_url: "https://maps.app.goo.gl/x", site_url: "", instagram_url: "", phone: "03-0000-0000" },
};

describe("parseStorePatch: 各画面の patch は通す", () => {
  it.each(Object.entries(SCREEN_PATCHES))("%s", (_screen, patch) => {
    expect(parseStorePatch(patch).ok).toBe(true);
  });

  it("基本情報の担当者の空文字は null に、アドレスは前後の空白を除く", () => {
    const parsed = parseStorePatch(SCREEN_PATCHES.basicInfo);
    expect(parsed).toMatchObject({
      ok: true,
      patch: { assigned_planner_user_id: PROFILE_ID, assigned_sales_user_id: null, contact_email: "contract@example.com" },
    });
  });

  it("値が undefined のキーは、変更しないものとして落とす", () => {
    const parsed = parseStorePatch({ genre: "居酒屋", contact_email: undefined });
    expect(parsed).toEqual({ ok: true, patch: { genre: "居酒屋" } });
  });

  it("営業資産 (ai_analysis_result) は検証を通った値と null だけを通す", () => {
    expect(parseStorePatch({ ai_analysis_result: null })).toEqual({ ok: true, patch: { ai_analysis_result: null } });
    expect(parseStorePatch({ ai_analysis_result: { strengths: 1 } }).ok).toBe(false);
  });
});

describe("parseStorePatch: 編集対象外の列は拒否する", () => {
  it.each([
    "tenant_id",
    "id",
    "created_at",
    "updated_at",
    "stage",
    "priority",
    "memo",
    "basic_info",
    "google_place_id",
    "appointment_acquired_date",
    "next_action_date",
    "next_action_note",
    "review_count",
    "review_avg",
    "__proto__",
    "constructor",
    "no_such_column",
  ])("%s を含む patch は、ほかの項目も含めて拒否する", (key) => {
    const raw = JSON.parse(`{"genre":"居酒屋",${JSON.stringify(key)}:"x"}`) as unknown;
    const parsed = parseStorePatch(raw);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.rejectedKeys).toContain(key);
  });

  it("許可リストに編集対象外の列が無い", () => {
    for (const key of ["tenant_id", "id", "created_at", "updated_at", "stage", "basic_info", "memo"]) {
      expect(EDITABLE_STORE_PATCH_FIELDS).not.toContain(key);
    }
  });
});

describe("parseStorePatch: 不正な値は拒否する", () => {
  it.each([
    ["patch がオブジェクトでない", null],
    ["patch が配列", [{ genre: "x" }]],
    ["patch が文字列", "genre=x"],
    ["店舗名が空白だけ", { name: "   " }],
    ["文字列の列に数値", { genre: 1 }],
    ["文字列の列に null", { phone: null }],
    ["文字列の列にオブジェクト", { city: { toString: "x" } }],
    ["長すぎる文字列", { address: "あ".repeat(1_001) }],
    ["長すぎる URL", { site_url: `https://example.com/${"a".repeat(4_100)}` }],
    ["定義外のチャネル", { channel: "メール推奨" }],
    ["定義外の問い合わせフォーム", { has_contact_form: "不明" }],
    ["定義外の運営者種別", { operator_type: "法人" }],
    ["担当者が uuid でない", { assigned_sales_user_id: "not-a-uuid" }],
    ["緯度の範囲外", { lat: 91 }],
    ["経度の範囲外", { lng: -181 }],
    ["緯度が文字列", { lat: "35.6" }],
    ["不正なアドレス", { contact_email: "a@@example.com" }],
    ["アドレスが null", { contact_email: null }],
  ])("%s", (_label, raw) => {
    expect(parseStorePatch(raw).ok).toBe(false);
  });

  it("エラー文言に入力値を含めない", () => {
    const parsed = parseStorePatch({ tenant_id: "secret-tenant", genre: "x" });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error).not.toContain("secret-tenant");
  });
});
