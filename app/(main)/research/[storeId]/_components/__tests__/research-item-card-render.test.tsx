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
import { ResearchItemCard } from "../research-item-card";

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
