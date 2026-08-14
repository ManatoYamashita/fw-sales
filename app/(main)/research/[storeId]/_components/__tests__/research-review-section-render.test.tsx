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
import type { Store } from "@/types/store";

vi.mock("server-only", () => ({}));

// Server Action を含むモジュールは DB 接続を要求するため、呼び出し面だけをモックする。
vi.mock("@/lib/actions/research-run-actions", () => ({
  adoptRemainingAndCompleteReviewAction: vi.fn(),
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
} as unknown as Store;

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

function render(run: StoreResearchRun): string {
  return renderToStaticMarkup(
    <ResearchReviewSection
      store={STORE}
      run={run}
      onUpdate={() => {}}
      onRestart={() => {}}
      restarting={false}
    />,
  );
}

describe("Primary CTA(Plan §12.1 / §12.1.1)", () => {
  const ITEMS = [
    item("business_hours_holidays", "confirmed"),
    item("seat_count", "confirmed"),
    item("main_target", "inferred"),
  ];

  it("Primary CTA は「残り N 件を採用して調査完了」", () => {
    const html = render(makeRun(ITEMS));
    expect(html).toContain("残り3件を採用して調査完了");
    expect(html).not.toContain("未確認項目をスキップしてレビュー完了");
  });

  it("採用対象の内訳(確認済み / 推定)を押す前に表示する", () => {
    const html = render(makeRun(ITEMS));
    expect(html).toContain("残り: 確認済み 2・推定 1");
  });

  it("Secondary CTA と未対応件数の補足を出す", () => {
    const html = render(makeRun(ITEMS));
    expect(html).toContain("判断済みの内容だけで完了");
    expect(html).toContain("未対応3件は反映されません");
  });

  it("未判断が0件なら Primary は「レビュー完了」になり Secondary は出さない", () => {
    const decisions: ReviewDecisions = {
      business_hours_holidays: { decision: "adopted", decided_at: "2026-08-12T00:00:00.000Z" },
      seat_count: { decision: "rejected", decided_at: "2026-08-12T00:00:00.000Z" },
      main_target: { decision: "skipped", decided_at: "2026-08-12T00:00:00.000Z" },
    };
    const html = render(makeRun(ITEMS, decisions));
    expect(html).toContain("レビュー完了");
    expect(html).not.toContain("判断済みの内容だけで完了");
  });
});

describe("conflict による Primary block(Plan §12.1)", () => {
  const WITH_CONFLICT = [
    item("business_hours_holidays", "confirmed"),
    item("average_spend_day_night", "conflict", {
      research_policy: "ANALYSIS",
      candidates: [
        { candidate_id: "c1", label: "候補A", value: "4,000円", evidence: "e", source_ids: [] },
        { candidate_id: "c2", label: "候補B", value: "5,000円", evidence: "e", source_ids: [] },
      ],
    }),
  ];

  it("conflictが未判断なら Primary を disabled にする", () => {
    const html = render(makeRun(WITH_CONFLICT));
    // Primary ボタン**そのもの**が disabled 属性付きで描画されることを確認する。
    // className に Tailwind の `disabled:opacity-50` 等が常に含まれるため、
    // 単なる部分文字列 "disabled" ではなく **属性**(`disabled=""`)を見る。
    expect(hasDisabledAttribute(html, "残り1件を採用して調査完了")).toBe(true);
  });

  it("conflictが無ければ Primary は disabled にならない(テストの検知能力の確認)", () => {
    const html = render(makeRun([item("business_hours_holidays", "confirmed")]));
    expect(hasDisabledAttribute(html, "残り1件を採用して調査完了")).toBe(false);
  });

  it("要選択件数を表示する", () => {
    const html = render(makeRun(WITH_CONFLICT));
    expect(html).toContain("要選択 1");
  });

  it("conflict は採用件数の内訳に含めない", () => {
    const html = render(makeRun(WITH_CONFLICT));
    expect(html).toContain("残り: 確認済み 1・推定 0");
  });
});

describe("完了後の状態", () => {
  it("レビュー完了後は sticky footer を描画せず、再調査ボタンのみ出す", () => {
    const run = { ...makeRun([item("seat_count", "confirmed")]), review_completed_at: "2026-08-12T01:00:00.000Z" };
    const html = render(run);
    expect(html).not.toContain("レビュー完了操作");
    expect(html).not.toContain("判断済みの内容だけで完了");
    expect(html).toContain("再調査する");
  });
});

describe("項目カードのボタン優先順位(Plan §12.3)", () => {
  it("採用 → 編集して採用 → 却下 → スキップ の順で描画する", () => {
    const html = render(makeRun([item("seat_count", "confirmed")]));
    const order = ["採用", "編集して採用", "却下", "スキップ"].map((label) => html.indexOf(label));
    expect(order.every((i) => i >= 0)).toBe(true);
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
/*  完了ブロッカーUX(conflict が残っている間の案内とジャンプ)            */
/* ------------------------------------------------------------------ */

const {
  ReviewCompletionFooter,
  buildConflictGuidance,
  buildSkipRemainingNote,
  handleConflictJump,
  researchItemAnchorId,
  scrollToResearchItem,
} = await import("../research-review-section");

/** 「営業時間・定休日」= business_hours_holidays / 「客単価（昼・夜）」= average_spend_day_night。 */
function conflictItem(key: string): ResearchItem {
  return item(key, "conflict", {
    research_policy: "ANALYSIS",
    candidates: [
      { candidate_id: "c1", label: "候補A", value: "A案", evidence: "e", source_ids: [] },
      { candidate_id: "c2", label: "候補B", value: "B案", evidence: "e", source_ids: [] },
    ],
  });
}

const DECIDED = { decision: "adopted", decided_at: "2026-08-12T00:00:00.000Z" } as const;

describe("buildConflictGuidance(文言の組み立て)", () => {
  it("未解決 conflict が無ければ null(= ブロックしていない)", () => {
    expect(buildConflictGuidance([], 30)).toBeNull();
  });

  it("1件: 項目名・残件数・次の操作を1文で説明する", () => {
    const g = buildConflictGuidance([{ key: "business_hours_holidays", label: "営業時間・定休日" }], 30);
    expect(g).not.toBeNull();
    expect(g!.count).toBe(1);
    expect(g!.targetKey).toBe("business_hours_holidays");
    expect(g!.headline).toBe("あと1件の候補選択で完了できます");
    expect(g!.detail).toBe(
      "「営業時間・定休日」の情報源が一致していません。候補を選ぶと、残り30件をまとめて採用できます。",
    );
    expect(g!.jumpLabel).toBe("営業時間・定休日を確認");
  });

  it("headline は残項目数ではなく「候補選択の回数」であることを明示する", () => {
    // footer には同時に「未対応 31」「残り30件を採用して調査完了」が出るため、
    // 「調査完了まであと1件」だと残項目数と誤読される(独立レビュー m1)。
    const g = buildConflictGuidance([{ key: "business_hours_holidays", label: "営業時間・定休日" }], 30);
    expect(g!.headline).toContain("候補選択");
    expect(g!.headline).not.toBe("調査完了まであと1件");
  });

  it("2件以上: 先頭 + ほかN件に畳み、全項目名を並べない", () => {
    const g = buildConflictGuidance(
      [
        { key: "business_hours_holidays", label: "営業時間・定休日" },
        { key: "average_spend_day_night", label: "客単価（昼・夜）" },
      ],
      30,
    );
    expect(g!.count).toBe(2);
    expect(g!.targetKey).toBe("business_hours_holidays");
    expect(g!.headline).toBe("あと2件の候補選択で完了できます");
    expect(g!.detail).toContain("「営業時間・定休日」ほか1件の情報源が一致していません");
    expect(g!.detail).toContain("残り30件をまとめて採用できます");
    expect(g!.detail).not.toContain("客単価");
    expect(g!.jumpLabel).toBe("競合2件を確認");
  });

  it("detail の「候補を1つ選ぶと」は headline と重複するため使わない", () => {
    const g = buildConflictGuidance([{ key: "business_hours_holidays", label: "営業時間・定休日" }], 30);
    expect(g!.detail).toContain("候補を選ぶと");
    expect(g!.detail).not.toContain("候補を1つ選ぶと");
  });

  it("採用対象が0件なら「調査を完了できます」へ切り替える(残り0件と書かない)", () => {
    const g = buildConflictGuidance([{ key: "business_hours_holidays", label: "営業時間・定休日" }], 0);
    expect(g!.detail).toBe("「営業時間・定休日」の情報源が一致していません。候補を選ぶと、調査を完了できます。");
    expect(g!.detail).not.toContain("残り0件");
  });

  it("先頭の conflict を解決すると targetKey / jumpLabel が次の conflict へ前進する", () => {
    // 既存テストは2番目を先に解決していたため、**先頭が残ったまま**で前進を検証できて
    // いなかった(独立レビュー m2)。ここでは先頭を解決した側を固定する。
    const all = [
      { key: "business_hours_holidays", label: "営業時間・定休日" },
      { key: "average_spend_day_night", label: "客単価（昼・夜）" },
    ];

    const before = buildConflictGuidance(all, 30);
    expect(before!.targetKey).toBe("business_hours_holidays");
    expect(before!.jumpLabel).toBe("競合2件を確認");

    // 先頭(business_hours_holidays)を採用 → 残りは average_spend_day_night のみ。
    const after = buildConflictGuidance(all.slice(1), 30);
    expect(after!.count).toBe(1);
    expect(after!.targetKey).toBe("average_spend_day_night");
    expect(after!.jumpLabel).toBe("客単価（昼・夜）を確認");
    expect(after!.detail).toContain("「客単価（昼・夜）」の情報源が一致していません");
    expect(after!.detail).not.toContain("営業時間・定休日");
  });

  it("失敗表現ではなく残作業として提示する", () => {
    const g = buildConflictGuidance([{ key: "business_hours_holidays", label: "営業時間・定休日" }], 30);
    const text = `${g!.headline}${g!.detail}${g!.jumpLabel}`;
    for (const ng of ["エラー", "処理できません", "失敗"]) {
      expect(text).not.toContain(ng);
    }
  });
});

describe("buildSkipRemainingNote(Secondary CTA の補足)", () => {
  it("競合が残っていれば内数として明示する", () => {
    expect(buildSkipRemainingNote(31, 1)).toBe("未対応31件（競合1件を含む）は反映されません");
  });

  it("競合が無ければ件数のみ", () => {
    expect(buildSkipRemainingNote(30, 0)).toBe("未対応30件は反映されません");
  });
});

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

describe("handleConflictJump(filter ON → 対象itemへ移動)", () => {
  it("「要確認のみ表示」を ON にしてから対象keyへスクロールする", () => {
    const calls: string[] = [];
    const setFilter = vi.fn((next: boolean) => {
      calls.push(`filter:${next}`);
    });
    const scroll = vi.fn((key: string) => {
      calls.push(`scroll:${key}`);
    });

    handleConflictJump("business_hours_holidays", setFilter, scroll);

    expect(setFilter).toHaveBeenCalledWith(true);
    expect(scroll).toHaveBeenCalledWith("business_hours_holidays");
    // 順序が逆だと filter 適用前の DOM に対してスクロールしてしまう。
    expect(calls).toEqual(["filter:true", "scroll:business_hours_holidays"]);
  });
});

describe("ブロック時の sticky footer 表示", () => {
  const ONE_CONFLICT = [
    item("seat_count", "confirmed"),
    item("main_target", "inferred"),
    conflictItem("business_hours_holidays"),
  ];

  it("実際の項目名を出す(件数だけにしない)", () => {
    const html = render(makeRun(ONE_CONFLICT));
    expect(html).toContain("営業時間・定休日");
    expect(html).toContain("あと1件の候補選択で完了できます");
  });

  it("「候補を選ぶと、残りN件をまとめて採用できます」を明示する", () => {
    const html = render(makeRun(ONE_CONFLICT));
    expect(html).toContain("候補を選ぶと、残り2件をまとめて採用できます");
  });

  it("ジャンプCTAを描画する(hoverしないと分からない設計にしない)", () => {
    const html = render(makeRun(ONE_CONFLICT));
    expect(html).toContain("営業時間・定休日を確認");
    expect(html).not.toContain("競合1件へ移動");
  });

  it("disabled 理由をボタン近傍へ常時表示し、aria-describedby で結び付ける", () => {
    const html = render(makeRun(ONE_CONFLICT));
    expect(html).toContain("競合を解決すると有効になります");
    const hintId = html.match(/id="([^"]+)"[^>]*>競合を解決すると有効になります/)?.[1];
    expect(hintId).toBeDefined();
    expect(html).toContain(`aria-describedby="${hintId}"`);
  });

  it("ジャンプ先itemに安定した DOM anchor と tabindex がある", () => {
    const html = render(makeRun(ONE_CONFLICT));
    expect(html).toContain('id="research-item-business_hours_holidays"');
    expect(html).toContain('tabindex="-1"');
  });

  it("Secondary CTA はブロック中も使用可能(競合を解決しない別ルート)", () => {
    const html = render(makeRun(ONE_CONFLICT));
    expect(hasDisabledAttribute(html, "判断済みの内容だけで完了")).toBe(false);
    expect(html).toContain("未対応3件（競合1件を含む）は反映されません");
  });
});

describe("複数 conflict", () => {
  const TWO_CONFLICTS = [
    item("seat_count", "confirmed"),
    conflictItem("business_hours_holidays"),
    conflictItem("average_spend_day_night"),
  ];

  it("件数と畳んだ項目名を出す", () => {
    const html = render(makeRun(TWO_CONFLICTS));
    expect(html).toContain("あと2件の候補選択で完了できます");
    expect(html).toContain("「営業時間・定休日」ほか1件の情報源が一致していません");
    expect(html).toContain("競合2件を確認");
  });

  it("2件目を解決してもまだ残っていれば block を維持する", () => {
    const html = render(makeRun(TWO_CONFLICTS, { average_spend_day_night: DECIDED }));
    expect(html).toContain("あと1件の候補選択で完了できます");
    expect(hasDisabledAttribute(html, "残り1件を採用して調査完了")).toBe(true);
  });

  it("**先頭**を解決すると案内とジャンプCTAが次の conflict へ前進する", () => {
    // 2番目を解決するケースだけでは先頭が残り続けるため、前進を検証できない(m2)。
    const html = render(makeRun(TWO_CONFLICTS, { business_hours_holidays: DECIDED }));
    expect(html).toContain("あと1件の候補選択で完了できます");
    expect(html).toContain("「客単価（昼・夜）」の情報源が一致していません");
    expect(html).toContain("客単価（昼・夜）を確認");
    // 解決済みの先頭項目はもう案内にもジャンプCTAにも出ない。
    expect(html).not.toContain("「営業時間・定休日」の情報源が一致していません");
    expect(html).not.toContain("営業時間・定休日を確認");
    expect(hasDisabledAttribute(html, "残り1件を採用して調査完了")).toBe(true);
  });

  it("最後の conflict を解決すると block 表示が消えて Primary が有効になる", () => {
    const html = render(
      makeRun(TWO_CONFLICTS, {
        average_spend_day_night: DECIDED,
        business_hours_holidays: DECIDED,
      }),
    );
    expect(html).not.toContain("の候補選択で完了できます");
    expect(html).not.toContain("競合を解決すると有効になります");
    expect(html).not.toContain("を確認</button>");
    expect(hasDisabledAttribute(html, "残り1件を採用して調査完了")).toBe(false);
  });
});

describe("ReviewCompletionFooter の busy / completing 挙動", () => {
  const SUMMARY = { confirmed: 2, inferred: 1, conflict: 0, adoptable: 3, total: 3 };
  const GUIDANCE = buildConflictGuidance(
    [{ key: "business_hours_holidays", label: "営業時間・定休日" }],
    3,
  );

  function renderFooter(overrides: Record<string, unknown> = {}): string {
    return renderToStaticMarkup(
      <ReviewCompletionFooter
        summary={SUMMARY}
        conflictGuidance={null}
        decidedCount={0}
        busy={false}
        completing={false}
        onAdoptRemaining={() => {}}
        onCompleteDecidedOnly={() => {}}
        onJumpToConflict={() => {}}
        {...overrides}
      />,
    );
  }

  it("idle なら Primary / Secondary とも有効", () => {
    const html = renderFooter();
    expect(hasDisabledAttribute(html, "残り3件を採用して調査完了")).toBe(false);
    expect(hasDisabledAttribute(html, "判断済みの内容だけで完了")).toBe(false);
  });

  it("busy 中は両方 disabled", () => {
    const html = renderFooter({ busy: true });
    expect(hasDisabledAttribute(html, "残り3件を採用して調査完了")).toBe(true);
    expect(hasDisabledAttribute(html, "判断済みの内容だけで完了")).toBe(true);
  });

  it("completing 中は Primary が「処理中…」になり両方 disabled", () => {
    const html = renderFooter({ completing: true });
    expect(hasDisabledAttribute(html, "処理中…")).toBe(true);
    expect(hasDisabledAttribute(html, "判断済みの内容だけで完了")).toBe(true);
  });

  it("conflict ブロック中でも Secondary だけは有効なまま", () => {
    const html = renderFooter({
      conflictGuidance: GUIDANCE,
      summary: { ...SUMMARY, conflict: 1, adoptable: 3, total: 4 },
    });
    expect(hasDisabledAttribute(html, "残り3件を採用して調査完了")).toBe(true);
    expect(hasDisabledAttribute(html, "判断済みの内容だけで完了")).toBe(false);
  });
});
