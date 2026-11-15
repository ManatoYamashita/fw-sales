import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  QUICK_FILTER_CHIP_SIZE_CLASS,
  quickFilterChipClassName,
  StoreQuickFilters,
  StoreQuickFiltersFallback,
} from "../store-quick-filters";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams("sales=me&next=overdue"),
}));

describe("クイックフィルタのタッチターゲット (#257)", () => {
  it.each([true, false])("active=%s でも最小高さ方式を使う", (active) => {
    const classes = quickFilterChipClassName(active).split(/\s+/);
    expect(classes).toContain("h-9");
    expect(classes).toContain("min-h-11");
    expect(classes).toContain("md:min-h-0");
    expect(classes.filter((token) => /:h-/.test(token))).toEqual([]);
  });

  it("すべての実リンクと fallback が同じ高さ指定を描画する", () => {
    const links = renderToStaticMarkup(<StoreQuickFilters />).match(/<a\b[^>]*>/g) ?? [];
    const placeholders = renderToStaticMarkup(<StoreQuickFiltersFallback />)
      .match(/<div\b[^>]*bg-muted\/40[^>]*>/g) ?? [];
    expect(links.length).toBeGreaterThan(0);
    expect(placeholders).toHaveLength(2);
    for (const element of [...links, ...placeholders]) {
      const classes = /class="([^"]*)"/.exec(element)?.[1]?.split(/\s+/) ?? [];
      for (const token of QUICK_FILTER_CHIP_SIZE_CLASS.split(/\s+/)) {
        expect(classes, element).toContain(token);
      }
    }
    expect(links.some((link) => link.includes('aria-current="true"'))).toBe(true);
    expect(links.every((link) => link.includes('href="/stores'))).toBe(true);
  });
});
