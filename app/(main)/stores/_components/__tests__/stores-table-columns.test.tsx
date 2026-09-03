/**
 * 店舗一覧の列優先度 (#220 / PR2/3) の配分を固定するテスト。
 *
 * 閾値は issue #220 の実測 min-content 幅の累計から決めており、1 列でも配分を
 * 変えるとその列以降の予算がまとめてずれる。ここで表を固定して、変更が
 * 「意図的な差分」としてレビューに乗るようにする。
 */

import { describe, expect, it, vi } from "vitest";
import {
  CARD_VIEW_BREAKPOINT,
  SELECTION_COLUMN_WIDTH,
  type ColumnMinContainerWidth,
} from "@/components/ui/data-table-responsive";

// 対象モジュールは Server Action を import しており、その先の repos → lib/db が
// 実 DB 接続を試みるためモックで遮断する (stores-table-empty-state.test.tsx と同規約)。
vi.mock("@/lib/actions/store-actions", () => ({
  bulkDeleteStoresAction: vi.fn(),
  deleteStoreAction: vi.fn(),
  getStoreDeleteImpactAction: vi.fn(),
}));

const { buildColumns } = await import("../stores-table-view");

/** 決定表。`undefined` は always (常時表示)。累計は issue #220 本文の表と一致する。 */
const EXPECTED: Record<string, ColumnMinContainerWidth | undefined> = {
  name: undefined, // 店舗名 260 ┐
  next: undefined, // 次回アクション 272 ├ always 計 632
  actions: undefined, // 操作 100 ┘
  stage: 728, // + 状態 96
  salesState: 874, // + 現在の営業状態 146
  sales: 971, // + 営業担当 97
  location: 1171, // + 最寄駅 200
  channel: 1281, // + チャネル 110
  updated: 1391, // + 最終営業日 110
  genre: 1492, // + 業態 101 (実効上限 1488px を超えるため 2000px 以上でのみ表示)
};

describe("店舗一覧の列優先度", () => {
  it("列の並びと閾値が決定表と一致する", () => {
    const columns = buildColumns(false);

    expect(columns.map((c) => c.key)).toEqual([
      "name",
      "location",
      "genre",
      "salesState",
      "next",
      "stage",
      "channel",
      "sales",
      "updated",
      "actions",
    ]);

    expect(
      Object.fromEntries(columns.map((c) => [c.key, c.minContainerWidth])),
    ).toEqual(EXPECTED);
  });

  it("閾値は canDelete に依存しない (選択列ぶんの加算は DataTable 側の責務)", () => {
    const forAdmin = buildColumns(true);
    const forMember = buildColumns(false);

    expect(forAdmin.map((c) => c.minContainerWidth)).toEqual(
      forMember.map((c) => c.minContainerWidth),
    );
  });

  it("always 列はソートやフィルタの起点になる 3 列に限る", () => {
    const always = buildColumns(false)
      .filter((c) => c.minContainerWidth === undefined)
      .map((c) => c.key);

    expect(always).toEqual(["name", "next", "actions"]);
  });

  it("上限の無い列を残さない (閾値の前提が実測 min-content 幅であるため)", () => {
    // 幅が内容依存で青天井になりうるのは自由入力のテキスト列。
    // truncate + maxWidth か、閉じた enum のバッジであることを求める。
    const columns = buildColumns(false);
    const column = (key: string) => {
      const found = columns.find((c) => c.key === key);
      expect(found, `列 ${key} が見つからない`).toBeDefined();
      return found!;
    };

    const caps: Record<string, string> = {
      name: "260px",
      location: "200px",
      sales: "100px",
      genre: "160px",
    };
    for (const [key, maxWidth] of Object.entries(caps)) {
      expect(column(key).maxWidth, `${key} の上限`).toBe(maxWidth);
      expect(column(key).truncate, `${key} は truncate されるべき`).toBe(true);
    }
  });

  it("always 列の min-content 合計がカード切替閾値に収まる (#234)", () => {
    // 「表ビューは always 列が確実に収まるときだけ描画される」という不変条件。
    // always 列を増やしたり cap を広げたりすると、表を出したまま横スクロールが
    // 残る帯が生まれる。そのときは切替閾値も一緒に上げること。
    const ALWAYS_MIN_CONTENT = 632; // 店舗名 260 + 次回アクション 272 + 操作 100
    expect(buildColumns(false).filter((c) => c.minContainerWidth === undefined).map((c) => c.key))
      .toEqual(["name", "next", "actions"]);
    expect(ALWAYS_MIN_CONTENT).toBeLessThanOrEqual(CARD_VIEW_BREAKPOINT);
    expect(ALWAYS_MIN_CONTENT + SELECTION_COLUMN_WIDTH).toBeLessThanOrEqual(
      CARD_VIEW_BREAKPOINT + SELECTION_COLUMN_WIDTH,
    );
  });
});