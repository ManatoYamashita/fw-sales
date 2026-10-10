/**
 * `ResearchReviewSection` の描画レベル検証
 * (feat/ai-research-quality-ux-hardening、Plan §15 UI / Q17)。
 *
 * `research-review-section.tsx` / `research-item-card.tsx` にはテストが1本も無く、
 * Primary CTA の変更を何も守れていなかった。本 repo には jsdom / testing-library を
 * 導入していないため、`research-failed-card-render.test.tsx` と同じく
 * `renderToStaticMarkup`(`react-dom/server`)で静的 HTML を得る方式を踏襲する
 * (新規依存なし)。
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { ResearchItem, ReviewDecisions, StoreResearchRun } from "@/types/research-run";
import type { ReviewPlanSummary } from "@/lib/domain/research-review";
import type { Store } from "@/types/store";
import type { BasicInfo, BasicInfoField } from "@/types/basic-info";

vi.mock("server-only", () => ({}));

// Server Action を含むモジュールは DB 接続を要求するため、呼び出し面だけをモックする。
vi.mock("@/lib/actions/research-run-actions", () => ({
  adoptBulkLaneAction: vi.fn(),
  completeReviewAction: vi.fn(),
  recordReviewDecisionAction: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const { ResearchReviewSection } = await import("../research-review-section");

function item(
  key: string,
  status: ResearchItem["status"],
  overrides: Partial<ResearchItem> = {},
): ResearchItem {
  return {
    key,
    research_policy: "FACT",
    status,
    value: status === "conflict" ? null : "値",
    evidence: "根拠",
    source_ids: [],
    ...overrides,
  };
}

const STORE: Store = {
  id: "store-1",
  name: "炉端ジュン",
  basic_info: {},
} as unknown as Store;

/** 調査結果から採用済みの基本情報の値。 */
function adoptedField(value: string): BasicInfoField {
  return {
    value,
    tier: "A",
    source_quote: "前回の根拠",
    filled_by: "manual",
    updated_at: "2026-09-01T00:00:00.000Z",
  };
}

function makeRun(items: ResearchItem[], decisions: ReviewDecisions = {}): StoreResearchRun {
  return {
    id: "run-1",
    store_id: "store-1",
    requested_by_user_id: null,
    status: "succeeded",
    stage: "done",
    result: items,
    source_registry: [],
    review_decisions: decisions,
    review_completed_at: null,
    token_usage: null,
    warnings: [],
    error_kind: null,
    error_message: null,
    started_at: "2026-08-12T00:00:00.000Z",
    expires_at: "2026-08-12T00:30:00.000Z",
    finished_at: "2026-08-12T00:03:00.000Z",
  };
}

/**
 * 指定ラベルの `<button>` が **disabled 属性付き**で描画されているかを判定する。
 *
 * className には Tailwind の `disabled:opacity-50` 等が常に含まれるため、
 * `html.includes("disabled")` では検知能力がゼロになる(常に true になる)。
 */
function hasDisabledAttribute(html: string, label: string): boolean {
  const match = html.match(new RegExp(`<button([^>]*)>${label}</button>`));
  if (match === null) throw new Error(`button not found: ${label}`);
  return / disabled(=|>|\s|$)/.test(`${match[1]!} `);
}

function render(run: StoreResearchRun, basicInfo: BasicInfo = {}): string {
  return renderToStaticMarkup(
    <ResearchReviewSection
      store={{ ...STORE, basic_info: basicInfo }}
      run={run}
      onUpdate={() => {}}
      onRestart={() => {}}
      restarting={false}
    />,
  );
}

/** `<details>` 要素(カード)の開始タグを id で取り出す。 */
function cardTag(html: string, key: string): string {
  const tag = html.match(new RegExp(`<details[^>]*id="research-item-${key}"[^>]*>`))?.[0];
  if (tag === undefined) throw new Error(`card not found: ${key}`);
  return tag;
}

const ITEMS = [
  item("business_hours_holidays", "confirmed"),
  item("seat_count", "confirmed"),
  item("main_target", "inferred"),
];

describe("主ボタン (#301: 推定を見ずに完了させない)", () => {
  it("確認済みの新規だけをまとめて採用し、推定は 1 件ずつに残す", () => {
    const html = render(makeRun(ITEMS));
    expect(html).toContain("2件をまとめて採用");
    expect(html).toContain("まとめて採用: 2件（新規 2）");
    expect(html).toContain("1件ずつ確認: 推定 1");
    // 推定まで含めた 3 件を採用する主ボタン(旧「残り3件を採用して調査完了」)は出さない。
    expect(html).not.toMatch(/3件を採用|3件をまとめて採用/);
  });

  it("推定しか残っていなければ、主ボタンは採用ではなく「次の未判断の項目へ」", () => {
    const html = render(makeRun([item("main_target", "inferred")]));
    expect(html).toContain(">次の未判断の項目へ</button>");
    expect(html).not.toMatch(/件をまとめて採用|件を採用して調査完了/);
  });

  it("まとめて採用した後に何も残らないなら「N件を採用して調査完了」", () => {
    const html = render(makeRun(ITEMS.slice(0, 2)));
    expect(html).toContain("2件を採用して調査完了");
  });

  it("副ボタンは未判断を反映せずに完了する", () => {
    const html = render(makeRun(ITEMS));
    expect(html).toContain("残り3件は反映せずに完了");
    expect(html).toContain("未対応の項目は基本情報に反映されません（いまの値のまま）");
  });

  it("未判断が0件なら主ボタンは「レビュー完了」になり副ボタンは出さない", () => {
    const decisions: ReviewDecisions = {
      business_hours_holidays: { decision: "adopted", decided_at: "2026-08-12T00:00:00.000Z" },
      seat_count: { decision: "rejected", decided_at: "2026-08-12T00:00:00.000Z" },
      main_target: { decision: "skipped", decided_at: "2026-08-12T00:00:00.000Z" },
    };
    const html = render(makeRun(ITEMS, decisions));
    expect(html).toContain(">レビュー完了</button>");
    expect(html).not.toContain("反映せずに完了");
  });

  it("競合が残っていても主ボタンは押せる(競合はまとめて採用しないため)", () => {
    const html = render(
      makeRun([
        item("business_hours_holidays", "confirmed"),
        item("average_spend_day_night", "conflict", {
          research_policy: "ANALYSIS",
          candidates: [
            { candidate_id: "c1", label: "候補A", value: "4,000円", evidence: "e", source_ids: [] },
            { candidate_id: "c2", label: "候補B", value: "5,000円", evidence: "e", source_ids: [] },
          ],
        }),
      ]),
    );
    expect(hasDisabledAttribute(html, "1件をまとめて採用")).toBe(false);
    expect(html).toContain("1件ずつ確認: 候補の選択 1");
  });
});

describe("上書きの事前表示 (#319)", () => {
  it("主ボタンを押す前に、上書きされる件数と内容が分かる", () => {
    const html = render(makeRun(ITEMS), { seat_count: adoptedField("18席") });
    expect(html).toContain("1件ずつ確認: 上書き 1・推定 1");
    expect(html).toContain("1件をまとめて採用");
    expect(html).toContain("いまの値（前回の調査で採用）: 18席");
    expect(html).toContain("調査の値: 値");
  });

  it("上書きになる項目のボタンは「上書きする」「いまの値を残す」", () => {
    const html = render(makeRun([item("seat_count", "confirmed")]), { seat_count: adoptedField("18席") });
    expect(html).toContain(">上書きする</button>");
    expect(html).toContain(">いまの値を残す</button>");
  });

  it("同じ値の項目は、採用しても基本情報が変わらないことが分かる", () => {
    const html = render(makeRun([item("seat_count", "confirmed")]), { seat_count: adoptedField("値") });
    expect(html).toContain("変更なし");
    expect(html).toContain("いまの値と同じです。採用しても基本情報は変わりません。");
    expect(html).toContain("まとめて採用: 1件（変更なし 1）");
  });

  it("同じ値は推定でもまとめて採用に入る", () => {
    const html = render(makeRun([item("main_target", "inferred")]), { main_target: adoptedField("値") });
    expect(html).toContain("1件を採用して調査完了");
  });
});

describe("折りたたみ (#301)", () => {
  it("まとめて採用する項目は閉じ、1 件ずつ確認する項目は開いておく", () => {
    const html = render(makeRun(ITEMS));
    expect(cardTag(html, "seat_count")).not.toMatch(/ open=""/);
    expect(cardTag(html, "main_target")).toMatch(/ open=""/);
  });

  it("判断済みの項目は閉じる", () => {
    const html = render(
      makeRun(ITEMS, { main_target: { decision: "rejected", decided_at: "2026-08-12T00:00:00.000Z" } }),
    );
    expect(cardTag(html, "main_target")).not.toMatch(/ open=""/);
  });

  it("値の出なかった項目は 1 つの閉じた折りたたみにまとめる", () => {
    const html = render(makeRun([...ITEMS, item("budget_range", "not_found", { value: null })]));
    expect(html).toContain("調査で値が出なかった項目(1項目)");
    expect(html).toMatch(/<details class="[^"]*">\s*<summary[^>]*>調査で値が出なかった項目/);
  });
});

describe("buildReviewFooterModel", () => {
  const summary = (overrides: Partial<ReviewPlanSummary> = {}): ReviewPlanSummary => ({
    total: 0,
    bulkKeys: [],
    bulk: { new: 0, same: 0 },
    individual: { overwrite: 0, noted: 0, inferred: 0, registered: 0 },
    choose: 0,
    remainingKeys: [],
    ...overrides,
  });

  it("#319 の本番の形(新規 1・変更なし 5・上書き 25)", () => {
    const model = buildReviewFooterModel(
      summary({
        total: 31,
        bulkKeys: ["a", "b", "c", "d", "e", "f"],
        bulk: { new: 1, same: 5 },
        individual: { overwrite: 25, noted: 0, inferred: 0, registered: 0 },
        remainingKeys: Array.from({ length: 25 }, (_, i) => `o${i}`),
      }),
    );
    expect(model.bulkLine).toBe("まとめて採用: 6件（新規 1・変更なし 5）");
    expect(model.remainingLine).toBe("1件ずつ確認: 上書き 25");
    expect(model.primary).toEqual({
      kind: "bulk",
      label: "6件をまとめて採用",
      keys: ["a", "b", "c", "d", "e", "f"],
      complete: false,
    });
    expect(model.skipLabel).toBe("残り31件は反映せずに完了");
  });

  it("まとめて採用が無く残りがあれば、先頭の残り項目へ移動する", () => {
    const model = buildReviewFooterModel(
      summary({ total: 2, individual: { overwrite: 0, noted: 0, inferred: 2, registered: 0 }, remainingKeys: ["x", "y"] }),
    );
    expect(model.primary).toEqual({ kind: "next", label: "次の未判断の項目へ", targetKey: "x" });
    expect(model.bulkLine).toBeNull();
  });

  it("未判断が無ければ完了だけ", () => {
    const model = buildReviewFooterModel(summary());
    expect(model.primary).toEqual({ kind: "complete", label: "レビュー完了" });
    expect(model.bulkLine).toBeNull();
    expect(model.remainingLine).toBeNull();
    expect(model.skipLabel).toBeNull();
  });
});

describe("完了後の状態", () => {
  it("レビュー完了後は sticky footer を描画せず、再調査ボタンのみ出す", () => {
    const run = { ...makeRun([item("seat_count", "confirmed")]), review_completed_at: "2026-08-12T01:00:00.000Z" };
    const html = render(run);
    expect(html).not.toContain("レビュー完了操作");
    expect(html).not.toContain("反映せずに完了");
    expect(html).toContain("再調査する");
  });
});

describe("狭い画面の完了操作", () => {
  it("未完了の操作領域は低い viewport で高さを制限して内部スクロールできる", () => {
    const html = render(makeRun([item("seat_count", "confirmed")]));
    const footer = html.match(/<div[^>]*role="region"[^>]*aria-label="レビュー完了操作"[^>]*>/)?.[0];
    expect(footer).toBeDefined();
    expect(footer).toContain("max-h-[70dvh]");
    expect(footer).toContain("overflow-y-auto");
  });
});

describe("項目カードのボタン優先順位(Plan §12.3)", () => {
  it("採用 → 編集して採用 → 却下 → スキップ の順で描画する", () => {
    const html = render(makeRun([item("seat_count", "confirmed")]));
    // 「編集して採用」は「採用」を部分文字列に含むため、文字列位置ではなく出現順で比較する
    const buttons = [...html.matchAll(/>([^<>]+)<\/button>/g)].map((m) => m[1]);
    const reviewButtons = buttons.filter((b) =>
      ["採用", "編集して採用", "却下", "スキップ"].includes(b!),
    );
    expect(reviewButtons).toEqual(["採用", "編集して採用", "却下", "スキップ"]);
  });
});

describe("existing_canonical の provenance 表示(Plan §7.3)", () => {
  it("fresh と区別できるバッジ文言を出し、『今回確認』と書かない", () => {
    const html = render(
      makeRun([
        item("official_site", "confirmed", {
          value: "あり (https://robata-jun.com/)",
          evidence_basis: "existing_canonical",
        }),
      ]),
    );
    expect(html).toContain("登録済み情報(今回のWeb再確認なし)");
    expect(html).not.toContain("今回の調査時点のGoogle Placesで確認");
  });

  it("fresh Places は別文言で表示する", () => {
    const html = render(
      makeRun([item("review_avg", "confirmed", { value: "4.4", evidence_basis: "places" })]),
    );
    expect(html).toContain("Google Placesで確認");
    expect(html).not.toContain("登録済み情報(今回のWeb再確認なし)");
  });
});

/* ------------------------------------------------------------------ */
/*  項目へのジャンプと footer                                           */
/* ------------------------------------------------------------------ */

const {
  ReviewCompletionFooter,
  buildReviewFooterModel,
  handleItemJump,
  researchItemAnchorId,
  scrollToResearchItem,
} = await import("../research-review-section");

describe("researchItemAnchorId / scrollToResearchItem", () => {
  it("anchor id は日本語ラベルではなく canonical key から決まる", () => {
    expect(researchItemAnchorId("business_hours_holidays")).toBe("research-item-business_hours_holidays");
  });

  it("DOM が無い環境では何もせず false を返す(SSR安全)", () => {
    expect(scrollToResearchItem("business_hours_holidays")).toBe(false);
  });

  it("対象要素があれば scrollIntoView と focus を呼ぶ", () => {
    const scrollIntoView = vi.fn();
    const focus = vi.fn();
    const getElementById = vi.fn(() => ({ scrollIntoView, focus }));
    vi.stubGlobal("document", { getElementById });
    try {
      expect(scrollToResearchItem("business_hours_holidays")).toBe(true);
      expect(getElementById).toHaveBeenCalledWith("research-item-business_hours_holidays");
      expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "center" });
      // スクロール位置を二重に動かさない。
      expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("対象要素が無ければ false(例外にしない)", () => {
    vi.stubGlobal("document", { getElementById: () => null });
    try {
      expect(scrollToResearchItem("business_hours_holidays")).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

/**
 * 折りたたまれたカテゴリへのジャンプ(独立レビュー M1)。
 *
 * カテゴリは `<details open>` だが `open` は uncontrolled で、ユーザーが手で閉じても
 * React は開き直さない(React 19.2.4 は `details` に対し `toggle` 購読のみで、
 * `input` のような state 復元を持たない)。閉じた `<details>` の子孫は DOM に存在するため
 * `getElementById` は要素を返すが、描画されていないので `scrollIntoView` は no-op、
 * `focus()` も中止される = **ユーザーには何も起きないように見える**。
 *
 * `HTMLDetailsElement` は node environment に存在しないため、実装は `instanceof` ではなく
 * `"open" in ancestor` で判定する。ここではその契約を stub で固定する。
 */
describe("scrollToResearchItem — 折りたたまれた <details>(M1)", () => {
  /** `open` の代入をイベントとして記録できる details stub。 */
  function makeDetails(calls: string[], name: string, parentElement: unknown = null) {
    return {
      _open: false,
      get open(): boolean {
        return this._open;
      },
      set open(next: boolean) {
        this._open = next;
        calls.push(`open:${name}`);
      },
      parentElement,
    };
  }

  it("閉じた祖先 details を開いてから scroll / focus する(順序も固定)", () => {
    const calls: string[] = [];
    const details = makeDetails(calls, "category");
    const el = {
      closest: (selector: string) => (selector === "details" ? details : null),
      scrollIntoView: vi.fn(() => calls.push("scroll")),
      focus: vi.fn(() => calls.push("focus")),
    };
    vi.stubGlobal("document", { getElementById: () => el });

    try {
      expect(details.open).toBe(false);
      expect(scrollToResearchItem("business_hours_holidays")).toBe(true);

      // 開かないまま scroll しても要素は描画されておらず何も起きない。
      expect(details.open).toBe(true);
      expect(el.scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "center" });
      expect(el.focus).toHaveBeenCalledWith({ preventScroll: true });
      expect(calls).toEqual(["open:category", "scroll", "focus"]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("ネストした details も祖先を辿ってすべて開く", () => {
    const calls: string[] = [];
    const outer = makeDetails(calls, "outer");
    // inner.parentElement.closest("details") が outer を返す = ネスト構造。
    const innerHost = { closest: (s: string) => (s === "details" ? outer : null) };
    const inner = makeDetails(calls, "inner", innerHost);
    const el = {
      closest: (s: string) => (s === "details" ? inner : null),
      scrollIntoView: vi.fn(() => calls.push("scroll")),
      focus: vi.fn(() => calls.push("focus")),
    };
    vi.stubGlobal("document", { getElementById: () => el });

    try {
      expect(scrollToResearchItem("business_hours_holidays")).toBe(true);
      expect(inner.open).toBe(true);
      expect(outer.open).toBe(true);
      // 内側から外側へ辿り、すべて開けてから scroll する。
      expect(calls).toEqual(["open:inner", "open:outer", "scroll", "focus"]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("既に開いている details でも壊さない(冪等)", () => {
    const calls: string[] = [];
    const details = makeDetails(calls, "category");
    details.open = true;
    calls.length = 0;
    const el = {
      closest: (s: string) => (s === "details" ? details : null),
      scrollIntoView: vi.fn(() => calls.push("scroll")),
      focus: vi.fn(() => calls.push("focus")),
    };
    vi.stubGlobal("document", { getElementById: () => el });

    try {
      expect(scrollToResearchItem("business_hours_holidays")).toBe(true);
      expect(details.open).toBe(true);
      expect(calls).toEqual(["open:category", "scroll", "focus"]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("closest を持たない要素でも例外にせず scroll / focus まで進む", () => {
    // `HTMLDetailsElement` への instanceof 依存や closest 必須化を防ぐガード。
    const el = { scrollIntoView: vi.fn(), focus: vi.fn() };
    vi.stubGlobal("document", { getElementById: () => el });

    try {
      expect(scrollToResearchItem("business_hours_holidays")).toBe(true);
      expect(el.scrollIntoView).toHaveBeenCalledTimes(1);
      expect(el.focus).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("祖先に details が無い場合も scroll / focus まで進む", () => {
    const el = {
      closest: () => null,
      scrollIntoView: vi.fn(),
      focus: vi.fn(),
    };
    vi.stubGlobal("document", { getElementById: () => el });

    try {
      expect(scrollToResearchItem("business_hours_holidays")).toBe(true);
      expect(el.scrollIntoView).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("handleItemJump(filter ON → 対象itemへ移動)", () => {
  it("「未判断の項目のみ表示」を ON にしてから対象keyへスクロールする", () => {
    const calls: string[] = [];
    const setFilter = vi.fn((next: boolean) => {
      calls.push(`filter:${next}`);
    });
    const scroll = vi.fn((key: string) => {
      calls.push(`scroll:${key}`);
    });

    handleItemJump("business_hours_holidays", setFilter, scroll);

    expect(setFilter).toHaveBeenCalledWith(true);
    expect(scroll).toHaveBeenCalledWith("business_hours_holidays");
    // 順序が逆だと filter 適用前の DOM に対してスクロールしてしまう。
    expect(calls).toEqual(["filter:true", "scroll:business_hours_holidays"]);
  });
});

describe("ReviewCompletionFooter の busy / completing 挙動", () => {
  const MODEL = {
    bulkLine: "まとめて採用: 2件（新規 2）",
    remainingLine: "1件ずつ確認: 推定 1",
    primary: { kind: "bulk" as const, label: "2件をまとめて採用", keys: ["a", "b"], complete: false },
    skipLabel: "残り3件は反映せずに完了",
  };

  function renderFooter(overrides: Record<string, unknown> = {}): string {
    return renderToStaticMarkup(
      <ReviewCompletionFooter
        model={MODEL}
        decidedCount={0}
        undecidedCount={3}
        busy={false}
        completing={false}
        onPrimary={() => {}}
        onCompleteDecidedOnly={() => {}}
        {...overrides}
      />,
    );
  }

  it("idle なら主ボタン / 副ボタンとも有効", () => {
    const html = renderFooter();
    expect(hasDisabledAttribute(html, "2件をまとめて採用")).toBe(false);
    expect(hasDisabledAttribute(html, "残り3件は反映せずに完了")).toBe(false);
  });

  it("busy 中は両方 disabled", () => {
    const html = renderFooter({ busy: true });
    expect(hasDisabledAttribute(html, "2件をまとめて採用")).toBe(true);
    expect(hasDisabledAttribute(html, "残り3件は反映せずに完了")).toBe(true);
  });

  it("completing 中は主ボタンが「処理中…」になり両方 disabled", () => {
    const html = renderFooter({ completing: true });
    expect(hasDisabledAttribute(html, "処理中…")).toBe(true);
    expect(hasDisabledAttribute(html, "残り3件は反映せずに完了")).toBe(true);
  });
});
