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

  it("Secondary CTA と「未対応項目は反映されません」の補足を出す", () => {
    const html = render(makeRun(ITEMS));
    expect(html).toContain("判断済みの内容だけで完了");
    expect(html).toContain("未対応項目は反映されません");
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

  it("要選択件数と誘導文言を表示する", () => {
    const html = render(makeRun(WITH_CONFLICT));
    expect(html).toContain("候補を選択する必要がある項目が1件あります");
    expect(html).toContain("競合1件へ移動");
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
