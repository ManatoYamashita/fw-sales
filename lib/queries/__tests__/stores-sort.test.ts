import { describe, expect, it } from "vitest";
import { applyStoreSort } from "@/lib/queries/store-sort";
import type { Store } from "@/types/store";

/**
 * テスト用に最小フィールドで Store を組み立てる。
 * applyStoreSort が参照するフィールドのみを意味のある値で渡し、
 * 残りは型を満たすダミー値で埋める。
 */
function makeStore(overrides: Partial<Store>): Store {
  return {
    id: "id",
    name: "",
    prefecture: "",
    city: "",
    address: "",
    genre: "",
    priority: "中",
    stage: "未調査",
    channel: "未判定",
    has_contact_form: "未確認",
    map_url: "",
    site_url: "",
    instagram_url: "",
    phone: "",
    target_service: "",
    review_count: 0,
    review_avg: 0,
    memo: "",
    assigned_planner_user_id: null,
    assigned_sales_user_id: null,
    operator_type: "未設定",
    operator_name: "",
    ai_analysis_result: null,
    lat: null,
    lng: null,
    google_place_id: null,
    basic_info: {},
    created_at: "2024-01-01",
    updated_at: "2024-01-01",
    ...overrides,
  };
}

const idsOf = (rows: Store[]) => rows.map((s) => s.id);

describe("applyStoreSort", () => {
  it("name: Intl.Collator(ja) で五十音順に asc できる", () => {
    const stores = [
      makeStore({ id: "c", name: "さくら" }),
      makeStore({ id: "a", name: "あおぞら" }),
      makeStore({ id: "b", name: "かもめ" }),
    ];
    const sorted = applyStoreSort(stores, { key: "name", dir: "asc" });
    expect(idsOf(sorted)).toEqual(["a", "b", "c"]);
  });

  it("location: 都道府県 + 市区の連結で asc", () => {
    const stores = [
      makeStore({ id: "tokyo-shibuya", prefecture: "東京都", city: "渋谷区" }),
      makeStore({ id: "aichi-nagoya", prefecture: "愛知県", city: "名古屋市" }),
      makeStore({ id: "tokyo-shinjuku", prefecture: "東京都", city: "新宿区" }),
    ];
    const sorted = applyStoreSort(stores, { key: "location", dir: "asc" });
    // 愛知県 < 東京都 (Intl.Collator(ja)) で愛知が先頭
    expect(sorted[0]?.id).toBe("aichi-nagoya");
  });

  it("review: 評価で並びつつ同点は件数で tie-break (desc 高い順)", () => {
    const stores = [
      makeStore({ id: "low", review_avg: 3.0, review_count: 100 }),
      makeStore({ id: "high-many", review_avg: 4.5, review_count: 200 }),
      makeStore({ id: "high-few", review_avg: 4.5, review_count: 50 }),
    ];
    const sorted = applyStoreSort(stores, { key: "review", dir: "desc" });
    expect(idsOf(sorted)).toEqual(["high-many", "high-few", "low"]);
  });

  it("stage: STAGE_IDS 定義順 (未調査 → 調査済み → ...) で asc", () => {
    const stores = [
      makeStore({ id: "called", stage: "架電済み" }),
      makeStore({ id: "untouched", stage: "未調査" }),
      makeStore({ id: "deep", stage: "DeepResearch済み" }),
      makeStore({ id: "researched", stage: "調査済み" }),
    ];
    const sorted = applyStoreSort(stores, { key: "stage", dir: "asc" });
    expect(idsOf(sorted)).toEqual([
      "untouched",
      "researched",
      "deep",
      "called",
    ]);
  });

  it("channel: CHANNELS 定義順で asc (DM推奨 → テレアポ推奨 → 要確認 → 未判定)", () => {
    const stores = [
      makeStore({ id: "unknown", channel: "未判定" }),
      makeStore({ id: "dm", channel: "DM推奨" }),
      makeStore({ id: "check", channel: "要確認" }),
      makeStore({ id: "tel", channel: "テレアポ推奨" }),
    ];
    const sorted = applyStoreSort(stores, { key: "channel", dir: "asc" });
    expect(idsOf(sorted)).toEqual(["dm", "tel", "check", "unknown"]);
  });

  describe("sales: profile display_name で並べる", () => {
    const profilesById = new Map<string, string>([
      ["u-tanaka", "田中 太郎"],
      ["u-sato", "佐藤 花子"],
      ["u-yamada", "山田 次郎"],
    ]);

    it("未割当(null)は asc でも末尾", () => {
      const stores = [
        makeStore({ id: "none1", assigned_sales_user_id: null }),
        makeStore({ id: "tanaka", assigned_sales_user_id: "u-tanaka" }),
        makeStore({ id: "sato", assigned_sales_user_id: "u-sato" }),
        makeStore({ id: "none2", assigned_sales_user_id: null }),
      ];
      const sorted = applyStoreSort(
        stores,
        { key: "sales", dir: "asc" },
        { profilesById },
      );
      // 担当ありが asc で並び、null は末尾
      const tail2 = idsOf(sorted).slice(-2);
      expect(tail2.sort()).toEqual(["none1", "none2"]);
      // 先頭は割当済みのうち localeCompare(ja) で先に来る方
      expect(["sato", "tanaka"]).toContain(sorted[0]?.id);
    });

    it("未割当(null)は desc でも末尾固定", () => {
      const stores = [
        makeStore({ id: "none", assigned_sales_user_id: null }),
        makeStore({ id: "tanaka", assigned_sales_user_id: "u-tanaka" }),
      ];
      const sorted = applyStoreSort(
        stores,
        { key: "sales", dir: "desc" },
        { profilesById },
      );
      expect(sorted[sorted.length - 1]?.id).toBe("none");
    });

    it("ctx 未指定なら name ソートにフォールバック", () => {
      const stores = [
        makeStore({ id: "z", name: "ぜ店" }),
        makeStore({ id: "a", name: "あ店" }),
      ];
      const sorted = applyStoreSort(stores, { key: "sales", dir: "asc" });
      expect(idsOf(sorted)).toEqual(["a", "z"]);
    });
  });

  it("updated: 更新日 desc で新しい順", () => {
    const stores = [
      makeStore({ id: "old", updated_at: "2024-01-01" }),
      makeStore({ id: "new", updated_at: "2024-12-31" }),
      makeStore({ id: "mid", updated_at: "2024-06-15" }),
    ];
    const sorted = applyStoreSort(stores, { key: "updated", dir: "desc" });
    expect(idsOf(sorted)).toEqual(["new", "mid", "old"]);
  });

  it("tie-breaker: 同値時は更新日 → 名前 → id の順で安定化", () => {
    const stores = [
      makeStore({
        id: "z",
        stage: "未調査",
        updated_at: "2024-01-01",
        name: "あ店",
      }),
      makeStore({
        id: "a",
        stage: "未調査",
        updated_at: "2024-01-01",
        name: "あ店",
      }),
    ];
    const sorted = applyStoreSort(stores, { key: "stage", dir: "asc" });
    expect(idsOf(sorted)).toEqual(["a", "z"]);
  });
});
