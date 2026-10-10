/**
 * `ResearchItemCard` の描画レベル検証 (#301)。
 *
 * 受け入れ条件「画面に内部用語が出ない」「ステータスと注記が矛盾するカードが無い」を、
 * 本番で実際に起きた 3 つの矛盾と、保存済みの旧文言で確かめる。
 * 本 repo には jsdom / testing-library を導入していないため、他の render テストと同じく
 * `renderToStaticMarkup` を使う。
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ResearchItem, SourceRegistryEntry } from "@/types/research-run";
import type { BasicInfoField } from "@/types/basic-info";
import {
  ResearchItemCard,
  pendingDecisionForItem,
  toPendingDecision,
  type PendingDecision,
} from "../research-item-card";

function makeItem(overrides: Partial<ResearchItem> = {}): ResearchItem {
  return {
    key: "phone",
    research_policy: "FACT",
    status: "confirmed",
    value: "045-305-6536",
    evidence: "公式サイトに記載",
    source_ids: [],
    ...overrides,
  };
}

const render = (item: ResearchItem, sourceRegistry: SourceRegistryEntry[] = []) =>
  renderToStaticMarkup(
    <ResearchItemCard
      item={item}
      label="項目"
      sourceRegistry={sourceRegistry}
      decision={undefined}
      busy={false}
      onDecide={() => {}}
      current={undefined}
      defaultOpen
    />,
  );

describe("ResearchItemCard (#301)", () => {
  it("保存済みの旧文言の注記を言い換え、内部用語を出さない", () => {
    const html = render(
      makeItem({
        status: "inferred",
        warning:
          "AIはconfirmedと判定しましたが、根拠となる情報源の本文取得が確認できなかったため自動的に格下げしました。 AIが返したresearch_policy(FACT)を正しい値(FACT_OR_HEARING)へ補正しました。",
      }),
    );
    expect(html).toContain("根拠のページを読み込めなかったため、確認済みにはしていません。");
    expect(html).not.toMatch(/confirmed|research_policy|格下げ/);
  });

  it("注記の無い確認済みは「確認済み」のバッジを出す (下の not.toContain の空振り防止)", () => {
    expect(render(makeItem())).toContain("確認済み</span>");
  });

  it("AI の不一致の注記が付いた確認済みは「注記あり」と出す (関内 なむらの電話番号)", () => {
    const html = render(
      makeItem({
        warning:
          "対象店舗のページとして確認できない情報源のみに依拠した候補を除外しました。 残った候補が1つだったため競合を解消しました。 情報源間で電話番号の末尾表記に不一致があります。",
      }),
    );
    expect(html).toContain("注記あり");
    expect(html).not.toContain("確認済み</span>");
    expect(html).toContain("情報源間で電話番号の末尾表記に不一致があります。");
  });

  it("Google Places 由来の項目に「出典なし」を出さない (Google 口コミ評価)", () => {
    const html = render(makeItem({ key: "review_avg", value: "4.2", evidence_basis: "places" }));
    expect(html).toContain("Google Places");
    expect(html).not.toContain("出典なし");
  });

  it("登録済みの値を折り返した項目は「確認済み」ではなく「登録済み」と出す (公式サイト有無)", () => {
    const html = render(
      makeItem({
        key: "official_site",
        value: "あり",
        evidence:
          "登録済みの基本情報として保持されている値です(最終更新 2026-09-01)。今回のWeb再確認はできていません。",
        evidence_basis: "existing_canonical",
      }),
    );
    expect(html).toContain("登録済み");
    expect(html).not.toContain("確認済み</span>");
    expect(html).not.toContain("出典なし");
  });

  it("旧 run の根拠末尾の媒体一覧(内部用語 run を含む)を出さない", () => {
    const html = render(
      makeItem({
        key: "own_net_exposure",
        research_policy: "ANALYSIS",
        value: "確認できた掲載媒体: ホットペッパーグルメ。 掲載が多い",
        evidence: "掲載が確認できる。 (このrunで実際に本文を確認できた情報源: ホットペッパーグルメ)",
      }),
    );
    expect(html).not.toContain("このrun");
    expect(html).toContain("掲載が確認できる。");
  });
});

/**
 * 押したボタンだけに処理中の表示を出す (#337)。
 *
 * 判断は全項目で 1 つの transition を共有している。`busy` だけを見ると全ボタンが
 * 一斉に薄くなるだけで、どれを押したかが分からなかった。
 */
describe("ResearchItemCard: 押したボタンだけを処理中にする (#337)", () => {
  /** ラベルで `<button>` を探し、属性部分を返す。処理中はラベルの前にスピナーの svg が入る。 */
  function buttonAttributes(html: string, label: string): string {
    const match = html.match(
      new RegExp(
        `<button([^>]*)>(?:<svg[^>]*data-slot="button-spinner"[^>]*>.*?</svg>)?(?:<svg[^>]*>.*?</svg>)?${label}</button>`,
      ),
    );
    if (match === null) throw new Error(`button not found: ${label}`);
    return `${match[1]!} `;
  }
  const isBusy = (html: string, label: string) => / aria-busy="true"/.test(buttonAttributes(html, label));
  const isDisabled = (html: string, label: string) => / disabled(=|\s)/.test(buttonAttributes(html, label));

  const renderPending = (
    item: ResearchItem,
    pendingDecision: PendingDecision | null,
    current?: BasicInfoField,
  ) =>
    renderToStaticMarkup(
      <ResearchItemCard
        item={item}
        label="項目"
        sourceRegistry={[]}
        decision={undefined}
        busy
        pendingDecision={pendingDecision}
        onDecide={() => {}}
        current={current}
        defaultOpen
      />,
    );

  it.each([
    ["adopted", "採用"],
    ["rejected", "却下"],
    ["skipped", "スキップ"],
  ] as const)("%s を押したら「%s」だけが処理中になり、ほかは押せないだけ", (decision, label) => {
    const html = renderPending(makeItem(), { decision, edited: false });
    const labels = ["採用", "編集して採用", "却下", "スキップ"];
    for (const other of labels) {
      expect(isDisabled(html, other)).toBe(true);
      expect(isBusy(html, other)).toBe(other === label);
    }
  });

  it("上書きになる項目では、言い換えたボタン (上書きする / いまの値を残す) が処理中になる", () => {
    const current: BasicInfoField = { value: "03-0000-0000", tier: "A", filled_by: "manual", updated_at: "2026-10-01T00:00:00.000Z" };
    const adopt = renderPending(makeItem(), { decision: "adopted", edited: false }, current);
    expect(isBusy(adopt, "上書きする")).toBe(true);
    expect(isBusy(adopt, "いまの値を残す")).toBe(false);
    const keep = renderPending(makeItem(), { decision: "rejected", edited: false }, current);
    expect(isBusy(keep, "いまの値を残す")).toBe(true);
    expect(isBusy(keep, "上書きする")).toBe(false);
  });

  it("候補を選ぶ項目では、押した候補のボタンだけが処理中になる", () => {
    const item = makeItem({
      status: "conflict",
      value: null,
      candidates: [
        { candidate_id: "a", label: "公式サイト", value: "045-111-1111", evidence: "公式", source_ids: [] },
        { candidate_id: "b", label: "Google Places", value: "045-222-2222", evidence: "Places", source_ids: [] },
      ],
    });
    const html = renderPending(item, { decision: "adopted", selectedCandidateId: "b", edited: false });
    expect(isBusy(html, "候補Bを採用")).toBe(true);
    expect(isBusy(html, "候補Aを採用")).toBe(false);
    expect(isDisabled(html, "候補Aを採用")).toBe(true);
  });

  it("「編集内容で採用」の処理中は、編集欄を残してそのボタンを処理中にする", () => {
    const html = renderPending(makeItem(), { decision: "adopted", edited: true });
    expect(html).toContain("<textarea");
    expect(isBusy(html, "編集内容で採用")).toBe(true);
    expect(isDisabled(html, "キャンセル")).toBe(true);
    // 「採用」と「編集内容で採用」は同じ adopted でもボタンが違う。
    expect(html).not.toContain(">採用</button>");
  });

  it("処理中の判断が無ければ (主ボタンの完了処理中など)、全ボタンが押せないだけ", () => {
    const html = renderPending(makeItem(), null);
    expect(html).not.toMatch(/ aria-busy="true"/);
    expect(isDisabled(html, "採用")).toBe(true);
  });
});

describe("pendingDecisionForItem (#337)", () => {
  const pending = { itemKey: "phone", decision: "adopted" as const, edited: false };

  it("判断の処理中なら、押した項目にだけ渡す", () => {
    expect(pendingDecisionForItem("phone", true, pending)).toBe(pending);
    expect(pendingDecisionForItem("address", true, pending)).toBeNull();
  });

  it("処理が終わった後は、記録が残っていても渡さない", () => {
    expect(pendingDecisionForItem("phone", false, pending)).toBeNull();
  });

  it("まだ何も押していなければ渡さない", () => {
    expect(pendingDecisionForItem("phone", true, null)).toBeNull();
  });
});

describe("toPendingDecision (#337)", () => {
  it("編集した値があれば「編集内容で採用」、無ければ「採用」として区別する", () => {
    expect(toPendingDecision({ decision: "adopted", editedValue: "x" }).edited).toBe(true);
    expect(toPendingDecision({ decision: "adopted", editedValue: "" }).edited).toBe(true);
    expect(toPendingDecision({ decision: "adopted" }).edited).toBe(false);
  });
});
