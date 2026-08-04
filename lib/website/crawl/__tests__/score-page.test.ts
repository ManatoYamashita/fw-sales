import { describe, expect, it } from "vitest";
import { scorePage, compareScoredLinks, selectSubpages, matchesCategory, type ScoredLink } from "../score-page";

describe("matchesCategory", () => {
  it("pathキーワード一致", () => {
    expect(matchesCategory("https://example.com/menu", "詳しく", "menu")).toBe(true);
  });

  it("anchorテキスト一致", () => {
    expect(matchesCategory("https://example.com/xyz", "メニューはこちら", "menu")).toBe(true);
  });

  it("一致しない場合はfalse", () => {
    expect(matchesCategory("https://example.com/xyz", "詳しく", "menu")).toBe(false);
  });

  it("不正なURLでも例外を投げない", () => {
    expect(matchesCategory("not a url", "メニュー", "menu")).toBe(true); // anchorのみで一致
    expect(matchesCategory("not a url", "詳しく", "menu")).toBe(false);
  });
});

describe("scorePage", () => {
  it("path一致は+10", () => {
    const s = scorePage("https://example.com/menu", "詳しく");
    expect(s.score).toBe(10);
    expect(s.category).toBe("menu");
  });

  it("anchor一致は+4", () => {
    const s = scorePage("https://example.com/xyz", "メニュー");
    expect(s.score).toBe(4);
    expect(s.category).toBe("menu");
  });

  it("path+anchor両方一致で+14", () => {
    const s = scorePage("https://example.com/menu", "メニュー");
    expect(s.score).toBe(14);
  });

  it("一致無しはscore 0 / category null", () => {
    const s = scorePage("https://example.com/random", "詳しく");
    expect(s.score).toBe(0);
    expect(s.category).toBeNull();
  });

  it("segmentCountを正しく数える", () => {
    expect(scorePage("https://example.com/a/b/c", "").segmentCount).toBe(3);
    expect(scorePage("https://example.com/", "").segmentCount).toBe(0);
  });

  it("複数カテゴリに一致する場合は最大スコアのカテゴリを採用する", () => {
    // "menu" は path+anchor一致(+14)、"about" はanchorのみ(+4) → menu が勝つ
    const s = scorePage("https://example.com/menu", "メニュー概要と当店について");
    expect(s.category).toBe("menu");
  });
});

describe("compareScoredLinks / selectSubpages", () => {
  function link(url: string, score: number, category: ScoredLink["category"], segmentCount = 1): ScoredLink {
    return { url, score, category, segmentCount };
  }

  it("score降順でソートする", () => {
    const a = link("https://example.com/a", 4, "about");
    const b = link("https://example.com/b", 10, "menu");
    expect(compareScoredLinks(a, b)).toBeGreaterThan(0);
  });

  it("同点はカテゴリ優先度(menu > reserve > access > about)で決まる", () => {
    const menu = link("https://example.com/a", 10, "menu");
    const about = link("https://example.com/b", 10, "about");
    expect(compareScoredLinks(menu, about)).toBeLessThan(0);
  });

  it("スコア・カテゴリ同点ならsegment数昇順", () => {
    const shallow = link("https://example.com/a", 10, "menu", 1);
    const deep = link("https://example.com/a/b/c", 10, "menu", 3);
    expect(compareScoredLinks(shallow, deep)).toBeLessThan(0);
  });

  it("全て同点ならURL文字列昇順", () => {
    const a = link("https://example.com/a", 10, "menu", 1);
    const b = link("https://example.com/b", 10, "menu", 1);
    expect(compareScoredLinks(a, b)).toBeLessThan(0);
  });

  it("入力順序を変えても同一結果になる(決定性)", () => {
    const candidates = [
      link("https://example.com/menu", 10, "menu"),
      link("https://example.com/access", 10, "access"),
      link("https://example.com/reserve", 10, "reserve"),
      link("https://example.com/about", 10, "about"),
    ];
    const shuffled = [candidates[3]!, candidates[0]!, candidates[2]!, candidates[1]!];
    const result1 = selectSubpages(candidates).map((c) => c.url);
    const result2 = selectSubpages(shuffled).map((c) => c.url);
    expect(result1).toEqual(result2);
  });

  it("上位4件のみを選ぶ", () => {
    const candidates = Array.from({ length: 10 }, (_, i) =>
      link(`https://example.com/p${i}`, 10 - i, "about"),
    );
    expect(selectSubpages(candidates).length).toBe(4);
  });

  it("他カテゴリに十分な候補があればsoft cap(同一カテゴリ最大2件)が保持される", () => {
    const candidates = [
      link("https://example.com/menu1", 10, "menu"),
      link("https://example.com/menu2", 10, "menu"),
      link("https://example.com/menu3", 10, "menu"),
      link("https://example.com/reserve1", 9, "reserve"),
      link("https://example.com/reserve2", 9, "reserve"),
      link("https://example.com/access1", 8, "access"),
    ];
    const selected = selectSubpages(candidates);
    const menuCount = selected.filter((c) => c.category === "menu").length;
    expect(menuCount).toBe(2);
    expect(selected.filter((c) => c.category === "reserve").length).toBe(2);
  });

  it("soft capを超えた候補も枠が余れば backfill される", () => {
    const candidates = [
      link("https://example.com/menu1", 10, "menu"),
      link("https://example.com/menu2", 10, "menu"),
      link("https://example.com/menu3", 10, "menu"),
      link("https://example.com/menu4", 10, "menu"),
    ];
    // 他カテゴリが無い場合、4件全てmenuでも4枠を無駄にしない
    expect(selectSubpages(candidates).length).toBe(4);
  });
});
