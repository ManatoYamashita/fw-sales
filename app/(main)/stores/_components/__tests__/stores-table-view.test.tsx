import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { SalesProgressRow } from "@/lib/domain/sales-progress";
import type { Store } from "@/types/store";
import { buildStoreLocationColumn } from "../store-location-column";

function rowWithBasicInfo(basicInfo: unknown): SalesProgressRow {
  return {
    store: { basic_info: basicInfo } as Store,
  } as SalesProgressRow;
}

function locationColumn() {
  return buildStoreLocationColumn();
}

describe("店舗一覧の最寄駅列", () => {
  it("見出し・sort互換性・省略表示設定を維持する", () => {
    const column = locationColumn();

    expect(column.header).toBe("最寄駅");
    expect(column.sortKey).toBe("location");
    expect(column.truncate).toBe(true);
    expect(column.maxWidth).toBe("200px");
  });

  it("最寄駅をtrimして表示し、titleに全文を設定する", () => {
    const column = locationColumn();
    const row = rowWithBasicInfo({
      nearest_station: { value: "  渋谷駅 徒歩5分／東京メトロ銀座線  " },
    });

    expect(renderToStaticMarkup(<>{column.cell(row)}</>)).toContain(
      "渋谷駅 徒歩5分／東京メトロ銀座線",
    );
    expect(column.title?.(row)).toBe("渋谷駅 徒歩5分／東京メトロ銀座線");
  });

  it.each([
    ["basic_infoなし", undefined],
    ["キーなし", {}],
    ["field null", { nearest_station: null }],
    ["value null", { nearest_station: { value: null } }],
    ["空文字", { nearest_station: { value: "" } }],
    ["空白のみ", { nearest_station: { value: "   " } }],
    ["不正なvalue型", { nearest_station: { value: 123 } }],
  ])("%sはダッシュ表示でtitleを付けない", (_label, basicInfo) => {
    const column = locationColumn();
    const row = rowWithBasicInfo(basicInfo);

    expect(renderToStaticMarkup(<>{column.cell(row)}</>)).toContain("—");
    expect(column.title?.(row)).toBeUndefined();
  });
});
