/**
 * StoreDeleteConfirmDialog の表示ロジック (純関数部) のユニットテスト
 * (#152 store-cascade-delete)。
 *
 * - カテゴリ定義: 4 カテゴリの表示順・ラベル・処理種別 (削除 / 紐付け解除) の単一の真実
 *   (Issue #110 で旧 research を撤去し、Issue #229 で store_research_runs を追加)
 * - visibleImpactEntries: 件数 > 0 のカテゴリのみを定義順で返す (Req 3.2 / 3.3)
 *
 * カテゴリ定義が stores の子テーブル実態と一致していることは
 * store-cascade-fk-coverage.test.ts が schema.ts のメタデータと突き合わせて検証する。
 * 本ファイルは「その定義がどう表示されるか」に限定する。
 *
 * ステートフルな描画 (取得中 / 失敗 / 成功の 3 状態, aria-live) は現行テスト基盤
 * (renderToStaticMarkup は effect 非実行・Modal は portal 使用) では検証できないため、
 * ブラウザ E2E (tasks.md 6.3) で確認する。
 */

import { describe, expect, it, vi } from "vitest";

// 対象モジュールは Server Action (getStoreDeleteImpactAction) を import しており、
// その先の repos → lib/db が実 DB 接続を試みるためモックで遮断する。
vi.mock("@/lib/actions/store-actions", () => ({
  getStoreDeleteImpactAction: vi.fn(),
}));

const {
  DELETE_IMPACT_CATEGORIES,
  IMPACT_EFFECT_LABEL,
  visibleImpactEntries,
} = await import("../store-delete-confirm-dialog");

describe("DELETE_IMPACT_CATEGORIES", () => {
  it("4 カテゴリを定義順 (営業記録 → AI調査 → 引き継ぎ → 場所候補) で保持する", () => {
    expect(DELETE_IMPACT_CATEGORIES.map((c) => c.key)).toEqual([
      "deals",
      "store_research_runs",
      "handoffs",
      "place_candidates",
    ]);
    expect(DELETE_IMPACT_CATEGORIES.map((c) => c.label)).toEqual([
      "営業記録",
      "AI調査",
      "引き継ぎ",
      "場所候補",
    ]);
  });

  it("処理種別は deals/store_research_runs/handoffs = delete、place_candidates = unlink (Req 3.2)", () => {
    const byKey = new Map(DELETE_IMPACT_CATEGORIES.map((c) => [c.key, c.effect]));
    expect(byKey.get("deals")).toBe("delete");
    expect(byKey.get("store_research_runs")).toBe("delete");
    expect(byKey.get("handoffs")).toBe("delete");
    expect(byKey.get("place_candidates")).toBe("unlink");
  });

  it("処理種別ラベルは利用者向け語彙 (同時に削除 / 紐付け解除)", () => {
    expect(IMPACT_EFFECT_LABEL.delete).toBe("同時に削除");
    expect(IMPACT_EFFECT_LABEL.unlink).toBe("紐付け解除");
  });
});

describe("visibleImpactEntries", () => {
  it("件数 > 0 のカテゴリのみを定義順で返す (0 件カテゴリは非表示 / Req 3.3)", () => {
    const entries = visibleImpactEntries({
      deals: 3,
      store_research_runs: 22,
      handoffs: 1,
      place_candidates: 4,
    });
    expect(entries).toEqual([
      { key: "deals", label: "営業記録", effect: "delete", count: 3 },
      {
        key: "store_research_runs",
        label: "AI調査",
        effect: "delete",
        count: 22,
      },
      { key: "handoffs", label: "引き継ぎ", effect: "delete", count: 1 },
      { key: "place_candidates", label: "場所候補", effect: "unlink", count: 4 },
    ]);
  });

  it("AI調査だけを持つ店舗が「紐づけデータはありません」に落ちない (#229 回帰)", () => {
    // 本番実測 (2026-09-03) では run を持つ 15 店舗のうち 13 店舗がこの形で、
    // deals / handoffs / place_candidates が全て 0 だった。store_research_runs を
    // カテゴリに持たなかった頃はエントリが空になり、ダイアログが
    // 「紐づけデータはありません。」と誤って断言していた (最大 22 件の調査結果が対象)。
    const entries = visibleImpactEntries({
      deals: 0,
      store_research_runs: 22,
      handoffs: 0,
      place_candidates: 0,
    });
    expect(entries).toEqual([
      {
        key: "store_research_runs",
        label: "AI調査",
        effect: "delete",
        count: 22,
      },
    ]);
  });

  it("全カテゴリ 0 件なら空配列を返す (呼び出し側が「紐づけデータはありません」を表示 / Req 3.4)", () => {
    expect(
      visibleImpactEntries({
        deals: 0,
        store_research_runs: 0,
        handoffs: 0,
        place_candidates: 0,
      }),
    ).toEqual([]);
  });
});
