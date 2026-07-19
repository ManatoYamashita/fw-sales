import { describe, expect, it } from "vitest";
import {
  applyProgressFilter,
  applyProgressSort,
  buildSalesProgressRows,
  buildLegacyProgressRedirect,
  deriveCurrentNextAction,
  deriveCurrentSalesState,
  getNextActionUrgency,
  pickLatestDeal,
  type SalesProgressRow,
} from "@/lib/domain/sales-progress";
import { applyStoreSort } from "@/lib/queries/store-sort";
import type { Deal } from "@/types/deal";
import type { Store } from "@/types/store";

/**
 * テスト用に最小フィールドで Store / Deal を組み立てる
 * (`stores-sort.test.ts` の makeStore と同規約)。
 */
function makeStore(overrides: Partial<Store>): Store {
  return {
    id: "store_x",
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
    appointment_acquired_date: null,
    next_action_date: null,
    next_action_note: null,
    basic_info: {},
    created_at: "2026-01-01",
    updated_at: "2026-01-01",
    ...overrides,
  };
}

function makeDeal(overrides: Partial<Deal>): Deal {
  return {
    id: "deal_x",
    store_id: "store_x",
    store_name: "",
    date: "2026-01-01",
    meeting_type: "対面",
    discussion: "",
    proposal: "",
    estimate_amount: 0,
    order_amount: null,
    lost_reason: "",
    status: "継続追客",
    assigned_sales_user_id: null,
    activity_memo: null,
    next_action_date: null,
    next_action_type: null,
    next_action_note: null,
    created_at: "2026-01-01",
    updated_at: "2026-01-01",
    ...overrides,
  };
}

const TODAY = "2026-07-15";

describe("deriveCurrentSalesState", () => {
  it.each([
    ["受注", "won"],
    ["失注", "lost"],
    ["見積提出", "estimated"],
    ["継続追客", "following"],
    ["初回接触", "initial"],
    ["アポ取得", "appointment"],
  ] as const)("最新商談 %s を営業状態へ導出する", (status, expected) => {
    expect(deriveCurrentSalesState(makeStore({}), makeDeal({ status }))).toBe(expected);
  });

  it("Deal.status は appointment_acquired_date / stage より優先される", () => {
    // store は「アポ取得済み・架電済み」でも、最新 Deal が「初回接触」なら Deal を優先する
    const store = makeStore({ appointment_acquired_date: "2026-07-01", stage: "架電済み" });
    expect(deriveCurrentSalesState(store, makeDeal({ status: "初回接触" }))).toBe("initial");
  });

  it.each([
    [{ appointment_acquired_date: "2026-07-01" }, "appointment"],
    [{ stage: "架電済み" }, "initial"],
    [{ stage: "DeepResearch済み" }, "researched"],
    [{ stage: "調査済み" }, "researched"],
    [{ stage: "未調査" }, "unresearched"],
  ] as const)("DealなしのStoreから営業状態を導出する", (overrides, expected) => {
    expect(deriveCurrentSalesState(makeStore(overrides), null)).toBe(expected);
  });

  it("期限状態は営業状態を上書きしない", () => {
    const store = makeStore({ next_action_date: "2026-07-01" });
    expect(getNextActionUrgency(store.next_action_date, TODAY)).toBe("overdue");
    expect(deriveCurrentSalesState(store, makeDeal({ status: "継続追客" }))).toBe("following");
  });
});

describe("deriveCurrentNextAction", () => {
  it("最新営業記録の次回アクションを優先する", () => {
    const store = makeStore({ next_action_date: "2026-08-01", next_action_note: "旧値" });
    const deal = makeDeal({ next_action_date: "2026-07-20", next_action_type: "電話", next_action_note: "見積確認" });
    expect(deriveCurrentNextAction(store, deal)).toEqual({ date: "2026-07-20", type: "電話", note: "見積確認", source: "deal" });
  });
  it("最新記録に次回アクションがなければStore legacy値へfallbackする", () => {
    const store = makeStore({ next_action_date: "2026-08-01", next_action_note: "旧値" });
    expect(deriveCurrentNextAction(store, makeDeal({}))).toEqual({ date: "2026-08-01", type: null, note: "旧値", source: "legacy-store" });
  });
});

describe("buildLegacyProgressRedirect", () => {
  it("旧営業進捗URLを店舗一覧へredirectし、互換parameterを保持する", () => {
    expect(buildLegacyProgressRedirect({ q: "東京", appt: "none", deal: "受注", sales: "u1", next: "today", sort: "meeting", dir: "desc", ignored: "x" })).toBe("/stores?q=%E6%9D%B1%E4%BA%AC&appt=none&deal=%E5%8F%97%E6%B3%A8&sales=u1&next=today&sort=meeting&dir=desc");
  });
  it("parameterなしでもredirect loopを作らない", () => {
    expect(buildLegacyProgressRedirect({})).toBe("/stores");
  });
});

describe("getNextActionUrgency", () => {
  it("null は unset", () => {
    expect(getNextActionUrgency(null, TODAY)).toBe("unset");
  });

  it("昨日は overdue", () => {
    expect(getNextActionUrgency("2026-07-14", TODAY)).toBe("overdue");
  });

  it("当日は today", () => {
    expect(getNextActionUrgency("2026-07-15", TODAY)).toBe("today");
  });

  it("翌日は upcoming", () => {
    expect(getNextActionUrgency("2026-07-16", TODAY)).toBe("upcoming");
  });

  it("YYYY-MM-DD 以外の形式は unset (文字列比較の誤判定を防ぐ)", () => {
    expect(getNextActionUrgency("2026/07/14", TODAY)).toBe("unset");
    expect(getNextActionUrgency("", TODAY)).toBe("unset");
  });

  it("月・年の境界も文字列比較で正しく判定する", () => {
    expect(getNextActionUrgency("2026-06-30", "2026-07-01")).toBe("overdue");
    expect(getNextActionUrgency("2027-01-01", "2026-12-31")).toBe("upcoming");
  });
});

describe("pickLatestDeal", () => {
  it("空配列は null", () => {
    expect(pickLatestDeal([])).toBeNull();
  });

  it("1 件ならその商談", () => {
    const deal = makeDeal({ id: "deal_a" });
    expect(pickLatestDeal([deal])).toBe(deal);
  });

  it("商談日 (date) が最も新しいものを選ぶ", () => {
    const older = makeDeal({ id: "deal_a", date: "2026-01-10", updated_at: "2026-07-01" });
    const newer = makeDeal({ id: "deal_b", date: "2026-02-01", updated_at: "2026-01-01" });
    expect(pickLatestDeal([older, newer])?.id).toBe("deal_b");
    expect(pickLatestDeal([newer, older])?.id).toBe("deal_b");
  });

  it("date 同点なら updated_at が新しいものを選ぶ", () => {
    const a = makeDeal({ id: "deal_a", date: "2026-02-01", updated_at: "2026-02-05" });
    const b = makeDeal({ id: "deal_b", date: "2026-02-01", updated_at: "2026-02-03" });
    expect(pickLatestDeal([a, b])?.id).toBe("deal_a");
    expect(pickLatestDeal([b, a])?.id).toBe("deal_a");
  });

  it("date / updated_at 同点なら id 降順 (決定的タイブレーク)", () => {
    const a = makeDeal({ id: "deal_a" });
    const b = makeDeal({ id: "deal_b" });
    expect(pickLatestDeal([a, b])?.id).toBe("deal_b");
    expect(pickLatestDeal([b, a])?.id).toBe("deal_b");
  });

  // #172: 営業記録削除後の最新記録の再計算 (削除は「配列から除いた状態で再導出」に等しい)
  describe("営業記録削除後の再計算 (#172)", () => {
    const oldest = makeDeal({ id: "deal_a", date: "2026-01-10" });
    const middle = makeDeal({ id: "deal_b", date: "2026-02-01" });
    const newest = makeDeal({ id: "deal_c", date: "2026-03-15" });

    it("最新記録を削除すると、一つ前の記録が最新になる", () => {
      expect(pickLatestDeal([oldest, middle, newest])?.id).toBe("deal_c");
      expect(pickLatestDeal([oldest, middle])?.id).toBe("deal_b");
    });

    it("過去記録を削除しても最新は変わらない", () => {
      expect(pickLatestDeal([oldest, newest])?.id).toBe("deal_c");
    });

    it("最後の 1 件を削除すると null (営業記録なし)", () => {
      expect(pickLatestDeal([])).toBeNull();
    });

    it("過去記録の日付を最新日より新しく更新すると、その記録が最新へ入れ替わる", () => {
      const promoted = makeDeal({ id: "deal_a", date: "2026-04-01" });
      expect(pickLatestDeal([promoted, middle, newest])?.id).toBe("deal_a");
    });

    it("最新記録の日付を最古へ更新すると、次に新しい記録が最新になる", () => {
      const demoted = makeDeal({ id: "deal_c", date: "2026-01-01" });
      expect(pickLatestDeal([oldest, middle, demoted])?.id).toBe("deal_b");
    });
  });
});

describe("buildSalesProgressRows", () => {
  it("商談ゼロの店舗も行になる (latestDeal: null)", () => {
    const stores = [makeStore({ id: "store_1" }), makeStore({ id: "store_2" })];
    const deals = [makeDeal({ id: "deal_1", store_id: "store_2" })];
    const rows = buildSalesProgressRows(stores, deals, undefined, TODAY);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.latestDeal).toBeNull();
    expect(rows[0]?.latestMeetingDate).toBeNull();
    expect(rows[1]?.latestDeal?.id).toBe("deal_1");
  });

  it("商談は store_id ごとにグルーピングして最新を選ぶ", () => {
    const stores = [makeStore({ id: "store_1" }), makeStore({ id: "store_2" })];
    const deals = [
      makeDeal({ id: "deal_1", store_id: "store_1", date: "2026-01-01" }),
      makeDeal({ id: "deal_2", store_id: "store_1", date: "2026-03-01" }),
      makeDeal({ id: "deal_3", store_id: "store_2", date: "2026-02-01" }),
    ];
    const rows = buildSalesProgressRows(stores, deals, undefined, TODAY);
    expect(rows[0]?.latestDeal?.id).toBe("deal_2");
    expect(rows[0]?.latestMeetingDate).toBe("2026-03-01");
    expect(rows[1]?.latestDeal?.id).toBe("deal_3");
  });

  it("アポ取得は appointment_acquired_date の有無から導出する", () => {
    const stores = [
      makeStore({ id: "store_1", appointment_acquired_date: "2026-07-01" }),
      makeStore({ id: "store_2", appointment_acquired_date: null }),
    ];
    const rows = buildSalesProgressRows(stores, [], undefined, TODAY);
    expect(rows[0]?.appointmentAcquired).toBe(true);
    expect(rows[1]?.appointmentAcquired).toBe(false);
  });

  it("営業担当名は profilesById で解決し、未割当 / 解決不能は null", () => {
    const stores = [
      makeStore({ id: "store_1", assigned_sales_user_id: "uuid-1" }),
      makeStore({ id: "store_2", assigned_sales_user_id: "uuid-unknown" }),
      makeStore({ id: "store_3", assigned_sales_user_id: null }),
    ];
    const profiles = new Map([["uuid-1", "山田"]]);
    const rows = buildSalesProgressRows(stores, [], profiles, TODAY);
    expect(rows[0]?.salesName).toBe("山田");
    expect(rows[1]?.salesName).toBeNull();
    expect(rows[2]?.salesName).toBeNull();
  });

  it("urgency は next_action_date から導出する", () => {
    const stores = [
      makeStore({ id: "store_1", next_action_date: "2026-07-10" }),
      makeStore({ id: "store_2", next_action_date: null }),
    ];
    const rows = buildSalesProgressRows(stores, [], undefined, TODAY);
    expect(rows[0]?.urgency).toBe("overdue");
    expect(rows[1]?.urgency).toBe("unset");
  });

  it("currentNextAction は最新 Deal の next_action_* を配線する (deriveCurrentNextAction 経由)", () => {
    const stores = [makeStore({ id: "store_1", next_action_note: "旧Store値" })];
    const deals = [
      makeDeal({ id: "deal_1", store_id: "store_1", date: "2026-01-01", next_action_note: "古い記録" }),
      makeDeal({ id: "deal_2", store_id: "store_1", date: "2026-03-01", next_action_date: "2026-07-20", next_action_type: "電話", next_action_note: "最新記録の次回アクション" }),
    ];
    const rows = buildSalesProgressRows(stores, deals, undefined, TODAY);
    expect(rows[0]?.currentNextAction).toEqual({
      date: "2026-07-20",
      type: "電話",
      note: "最新記録の次回アクション",
      source: "deal",
    });
    // 実装を誤って store.next_action_note を直接見るように書き換えても、
    // このテストは「旧Store値」ではなく「最新記録の次回アクション」を期待するため検知できる。
  });
});

/* ------------------------------------------------------------------ */
/*  フィルタ / ソート                                                   */
/* ------------------------------------------------------------------ */

function rowsOf(...pairs: Array<{ store: Store; deals?: Deal[] }>): SalesProgressRow[] {
  const stores = pairs.map((p) => p.store);
  const deals = pairs.flatMap((p) => p.deals ?? []);
  return buildSalesProgressRows(stores, deals, undefined, TODAY);
}

const idsOf = (rows: SalesProgressRow[]) => rows.map((r) => r.store.id);

describe("applyProgressFilter", () => {
  it("q: 店舗名 / エリア / 次回アクション内容 (Store legacy値) を部分一致検索する", () => {
    const rows = rowsOf(
      { store: makeStore({ id: "a", name: "導楽" }) },
      { store: makeStore({ id: "b", city: "川崎市" }) },
      { store: makeStore({ id: "c", next_action_note: "見積フォロー" }) },
      { store: makeStore({ id: "d" }) },
    );
    expect(idsOf(applyProgressFilter(rows, { q: "導楽" }))).toEqual(["a"]);
    expect(idsOf(applyProgressFilter(rows, { q: "川崎" }))).toEqual(["b"]);
    expect(idsOf(applyProgressFilter(rows, { q: "フォロー" }))).toEqual(["c"]);
  });

  it("q: 最新Dealのnext_action_note / next_action_typeで検索できる (一覧が実際に表示するcurrentNextAction経由)", () => {
    const rows = rowsOf({
      store: makeStore({ id: "a", next_action_note: null }),
      deals: [makeDeal({ id: "d1", store_id: "a", date: "2026-03-01", next_action_type: "電話", next_action_note: "見積フォローの電話" })],
    });
    expect(idsOf(applyProgressFilter(rows, { q: "見積フォロー" }))).toEqual(["a"]);
    expect(idsOf(applyProgressFilter(rows, { q: "電話" }))).toEqual(["a"]);
  });

  it("q: 古いDealだけに含まれる次回アクションでは検索ヒットしない (最新Dealのみが検索対象)", () => {
    const rows = rowsOf({
      store: makeStore({ id: "a" }),
      deals: [
        makeDeal({ id: "d1", store_id: "a", date: "2026-01-01", next_action_note: "古い記録の内容" }),
        makeDeal({ id: "d2", store_id: "a", date: "2026-03-01", next_action_note: "最新の内容" }),
      ],
    });
    expect(idsOf(applyProgressFilter(rows, { q: "古い記録" }))).toEqual([]);
    expect(idsOf(applyProgressFilter(rows, { q: "最新の内容" }))).toEqual(["a"]);
  });

  it("q: 大文字小文字・前後空白を無視する (既存挙動を維持)", () => {
    const rows = rowsOf({ store: makeStore({ id: "a", name: "ABC Store" }) });
    expect(idsOf(applyProgressFilter(rows, { q: "  abc  " }))).toEqual(["a"]);
    expect(idsOf(applyProgressFilter(rows, { q: "ABC" }))).toEqual(["a"]);
  });

  it("appt: acquired / none で絞り込める", () => {
    const rows = rowsOf(
      { store: makeStore({ id: "a", appointment_acquired_date: "2026-07-01" }) },
      { store: makeStore({ id: "b" }) },
    );
    expect(idsOf(applyProgressFilter(rows, { appt: "acquired" }))).toEqual(["a"]);
    expect(idsOf(applyProgressFilter(rows, { appt: "none" }))).toEqual(["b"]);
  });

  it("deal: 最新商談ステータスで絞り込める (商談なし店舗は除外)", () => {
    const rows = rowsOf(
      {
        store: makeStore({ id: "a" }),
        deals: [
          makeDeal({ id: "d1", store_id: "a", date: "2026-01-01", status: "受注" }),
          makeDeal({ id: "d2", store_id: "a", date: "2026-02-01", status: "失注" }),
        ],
      },
      {
        store: makeStore({ id: "b" }),
        deals: [makeDeal({ id: "d3", store_id: "b", status: "受注" })],
      },
      { store: makeStore({ id: "c" }) },
    );
    // 店舗 a の最新商談は失注 (date 降順)
    expect(idsOf(applyProgressFilter(rows, { deal: "失注" }))).toEqual(["a"]);
    expect(idsOf(applyProgressFilter(rows, { deal: "受注" }))).toEqual(["b"]);
  });

  it("deal: 'none' で商談ゼロの店舗のみに絞り込める", () => {
    const rows = rowsOf(
      {
        store: makeStore({ id: "a" }),
        deals: [makeDeal({ id: "d1", store_id: "a" })],
      },
      { store: makeStore({ id: "b" }) },
    );
    expect(idsOf(applyProgressFilter(rows, { deal: "none" }))).toEqual(["b"]);
  });

  it("sales: 営業担当 (profile.id) 完全一致で絞り込める", () => {
    const rows = rowsOf(
      { store: makeStore({ id: "a", assigned_sales_user_id: "uuid-1" }) },
      { store: makeStore({ id: "b", assigned_sales_user_id: "uuid-2" }) },
      { store: makeStore({ id: "c" }) },
    );
    expect(idsOf(applyProgressFilter(rows, { sales: "uuid-1" }))).toEqual(["a"]);
  });

  it("next: 緊急度で絞り込める (商談ゼロの店舗にも効く)", () => {
    const rows = rowsOf(
      { store: makeStore({ id: "a", next_action_date: "2026-07-01" }) },
      { store: makeStore({ id: "b", next_action_date: "2026-07-15" }) },
      { store: makeStore({ id: "c", next_action_date: "2026-08-01" }) },
      { store: makeStore({ id: "d" }) },
    );
    expect(idsOf(applyProgressFilter(rows, { next: "overdue" }))).toEqual(["a"]);
    expect(idsOf(applyProgressFilter(rows, { next: "today" }))).toEqual(["b"]);
    expect(idsOf(applyProgressFilter(rows, { next: "upcoming" }))).toEqual(["c"]);
    expect(idsOf(applyProgressFilter(rows, { next: "unset" }))).toEqual(["d"]);
  });

  it("複合条件は AND で絞り込む", () => {
    const rows = rowsOf(
      {
        store: makeStore({
          id: "a",
          appointment_acquired_date: "2026-07-01",
          assigned_sales_user_id: "uuid-1",
        }),
      },
      { store: makeStore({ id: "b", appointment_acquired_date: "2026-07-01" }) },
    );
    expect(
      idsOf(applyProgressFilter(rows, { appt: "acquired", sales: "uuid-1" })),
    ).toEqual(["a"]);
  });

  it("営業状態・調査段階・チャネルを統合して絞り込む", () => {
    const rows = rowsOf(
      { store: makeStore({ id: "a", stage: "DeepResearch済み", channel: "テレアポ推奨" }) },
      { store: makeStore({ id: "b", stage: "調査済み", channel: "DM推奨" }) },
    );
    expect(idsOf(applyProgressFilter(rows, { state: "researched" }))).toEqual(["a", "b"]);
    expect(idsOf(applyProgressFilter(rows, { stage: "調査済み" }))).toEqual(["b"]);
    expect(idsOf(applyProgressFilter(rows, { channel: "テレアポ推奨" }))).toEqual(["a"]);
  });
});

describe("applyProgressSort", () => {
  it("next asc: 日付昇順、未設定は末尾", () => {
    const rows = rowsOf(
      { store: makeStore({ id: "a", next_action_date: "2026-08-01" }) },
      { store: makeStore({ id: "b" }) },
      { store: makeStore({ id: "c", next_action_date: "2026-07-01" }) },
    );
    const sorted = applyProgressSort(rows, { key: "next", dir: "asc" });
    expect(idsOf(sorted)).toEqual(["c", "a", "b"]);
  });

  it("next desc: 日付降順でも未設定は末尾のまま", () => {
    const rows = rowsOf(
      { store: makeStore({ id: "a", next_action_date: "2026-08-01" }) },
      { store: makeStore({ id: "b" }) },
      { store: makeStore({ id: "c", next_action_date: "2026-07-01" }) },
    );
    const sorted = applyProgressSort(rows, { key: "next", dir: "desc" });
    expect(idsOf(sorted)).toEqual(["a", "c", "b"]);
  });

  it("meeting: 最終商談日でソートし、商談なしは末尾", () => {
    const rows = rowsOf(
      {
        store: makeStore({ id: "a" }),
        deals: [makeDeal({ id: "d1", store_id: "a", date: "2026-03-01" })],
      },
      { store: makeStore({ id: "b" }) },
      {
        store: makeStore({ id: "c" }),
        deals: [makeDeal({ id: "d2", store_id: "c", date: "2026-05-01" })],
      },
    );
    const sorted = applyProgressSort(rows, { key: "meeting", dir: "desc" });
    expect(idsOf(sorted)).toEqual(["c", "a", "b"]);
  });

  it("同点は更新日新しい順 → 店舗名 → id で安定化する", () => {
    const rows = rowsOf(
      { store: makeStore({ id: "b", updated_at: "2026-01-01" }) },
      { store: makeStore({ id: "a", updated_at: "2026-01-01" }) },
      { store: makeStore({ id: "c", updated_at: "2026-02-01" }) },
    );
    const sorted = applyProgressSort(rows, { key: "next", dir: "asc" });
    expect(idsOf(sorted)).toEqual(["c", "a", "b"]);
  });

  it("stage asc: STAGE_IDS の定義順 (辞書順に退行しない)", () => {
    const rows = rowsOf(
      { store: makeStore({ id: "a", stage: "DeepResearch済み" }) },
      { store: makeStore({ id: "b", stage: "未調査" }) },
      { store: makeStore({ id: "c", stage: "架電済み" }) },
      { store: makeStore({ id: "d", stage: "調査済み" }) },
    );
    // STAGE_IDS 定義順: 未調査 → 調査済み → DeepResearch済み → 架電済み
    // (辞書順なら DeepResearch済み → 架電済み → 未調査 → 調査済み になってしまう)
    expect(idsOf(applyProgressSort(rows, { key: "stage", dir: "asc" }))).toEqual(["b", "d", "a", "c"]);
  });

  it("stage desc: 定義順の逆順", () => {
    const rows = rowsOf(
      { store: makeStore({ id: "a", stage: "DeepResearch済み" }) },
      { store: makeStore({ id: "b", stage: "未調査" }) },
      { store: makeStore({ id: "c", stage: "架電済み" }) },
      { store: makeStore({ id: "d", stage: "調査済み" }) },
    );
    expect(idsOf(applyProgressSort(rows, { key: "stage", dir: "desc" }))).toEqual(["c", "a", "d", "b"]);
  });

  it("channel asc: CHANNELS の定義順 (辞書順に退行しない)", () => {
    const rows = rowsOf(
      { store: makeStore({ id: "a", channel: "未判定" }) },
      { store: makeStore({ id: "b", channel: "DM推奨" }) },
      { store: makeStore({ id: "c", channel: "要確認" }) },
      { store: makeStore({ id: "d", channel: "テレアポ推奨" }) },
    );
    // CHANNELS 定義順: DM推奨 → テレアポ推奨 → 要確認 → 未判定
    expect(idsOf(applyProgressSort(rows, { key: "channel", dir: "asc" }))).toEqual(["b", "d", "c", "a"]);
  });

  it("channel desc: 定義順の逆順", () => {
    const rows = rowsOf(
      { store: makeStore({ id: "a", channel: "未判定" }) },
      { store: makeStore({ id: "b", channel: "DM推奨" }) },
      { store: makeStore({ id: "c", channel: "要確認" }) },
      { store: makeStore({ id: "d", channel: "テレアポ推奨" }) },
    );
    expect(idsOf(applyProgressSort(rows, { key: "channel", dir: "desc" }))).toEqual(["a", "c", "d", "b"]);
  });

  it("applyStoreSort と同じ順序規則になる (STAGE_IDS/CHANNELS を単一の真実として共有)", () => {
    const stores = [
      makeStore({ id: "a", stage: "DeepResearch済み", channel: "未判定" }),
      makeStore({ id: "b", stage: "未調査", channel: "DM推奨" }),
      makeStore({ id: "c", stage: "架電済み", channel: "要確認" }),
      makeStore({ id: "d", stage: "調査済み", channel: "テレアポ推奨" }),
    ];
    const rows = rowsOf(...stores.map((store) => ({ store })));

    const storeStageOrder = applyStoreSort(stores, { key: "stage", dir: "asc" }).map((s) => s.id);
    const progressStageOrder = idsOf(applyProgressSort(rows, { key: "stage", dir: "asc" }));
    expect(progressStageOrder).toEqual(storeStageOrder);

    const storeChannelOrder = applyStoreSort(stores, { key: "channel", dir: "asc" }).map((s) => s.id);
    const progressChannelOrder = idsOf(applyProgressSort(rows, { key: "channel", dir: "asc" }));
    expect(progressChannelOrder).toEqual(storeChannelOrder);
  });
});
