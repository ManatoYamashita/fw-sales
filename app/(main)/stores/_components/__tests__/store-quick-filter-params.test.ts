import { describe, expect, it } from "vitest";
import {
  buildAssigneeHref,
  buildTimingHref,
  readQuickFilterState,
  type AssigneeScope,
  type TimingScope,
} from "../store-quick-filter-params";

/** クエリ文字列から `URLSearchParams` を作る小さなヘルパ。 */
function params(qs: string): URLSearchParams {
  return new URLSearchParams(qs);
}

/** href のクエリ部分を key -> value のオブジェクトに戻す (順序非依存に比較する)。 */
function queryOf(href: string): Record<string, string> {
  const [path, qs] = href.split("?");
  expect(path).toBe("/stores");
  return Object.fromEntries(new URLSearchParams(qs ?? ""));
}

describe("readQuickFilterState", () => {
  it("sales 未指定は担当範囲 all", () => {
    expect(readQuickFilterState(params("")).assignee).toBe("all");
  });

  it.each<[string, AssigneeScope]>([
    ["sales=me", "me"],
    ["sales=none", "none"],
  ])("%s は担当範囲 %s", (qs, expected) => {
    expect(readQuickFilterState(params(qs)).assignee).toBe(expected);
  });

  it("担当者 UUID 指定はどのチップも active にしない", () => {
    // 実際には 1 人分に絞られているので「すべて」を点灯させると嘘になる。
    expect(readQuickFilterState(params("sales=uuid-1")).assignee).toBeNull();
  });

  it("空の sales は担当範囲 all として扱う", () => {
    expect(readQuickFilterState(params("sales=")).assignee).toBe("all");
  });

  it.each<[string, TimingScope]>([
    ["next=overdue", "overdue"],
    ["next=today", "today"],
  ])("%s は対応タイミング %s", (qs, expected) => {
    expect(readQuickFilterState(params(qs)).timing).toBe(expected);
  });

  it.each(["", "next=upcoming", "next=unset", "next=bogus"])(
    "クイックフィルタが持たない next 値 (%s) はどのチップも active にしない",
    (qs) => {
      expect(readQuickFilterState(params(qs)).timing).toBeNull();
    },
  );

  it("2 軸は同時に active になれる", () => {
    expect(readQuickFilterState(params("sales=me&next=overdue"))).toEqual({
      assignee: "me",
      timing: "overdue",
    });
  });
});

describe("buildAssigneeHref (担当範囲の軸)", () => {
  it("sales のみを書き換える", () => {
    expect(queryOf(buildAssigneeHref(params(""), "me"))).toEqual({ sales: "me" });
    expect(queryOf(buildAssigneeHref(params(""), "none"))).toEqual({ sales: "none" });
  });

  it("all は sales を削除する", () => {
    expect(queryOf(buildAssigneeHref(params("sales=me"), "all"))).toEqual({});
  });

  it("対応タイミング (next) を消さない", () => {
    expect(queryOf(buildAssigneeHref(params("next=overdue"), "me"))).toEqual({
      next: "overdue",
      sales: "me",
    });
    // 「すべて」に戻しても next は残る
    expect(
      queryOf(buildAssigneeHref(params("sales=me&next=today"), "all")),
    ).toEqual({ next: "today" });
  });

  it("担当者 UUID 指定を me / none で上書きできる", () => {
    expect(queryOf(buildAssigneeHref(params("sales=uuid-1"), "me"))).toEqual({
      sales: "me",
    });
  });
});

describe("buildTimingHref (対応タイミングの軸)", () => {
  it("next のみを書き換える", () => {
    expect(queryOf(buildTimingHref(params(""), "overdue"))).toEqual({
      next: "overdue",
    });
  });

  it("担当範囲 (sales) を消さない", () => {
    expect(queryOf(buildTimingHref(params("sales=me"), "overdue"))).toEqual({
      sales: "me",
      next: "overdue",
    });
    expect(queryOf(buildTimingHref(params("sales=none"), "today"))).toEqual({
      sales: "none",
      next: "today",
    });
  });

  it("選択中のチップを再度押すと next だけを落とす (トグル)", () => {
    expect(
      queryOf(buildTimingHref(params("sales=me&next=overdue"), "overdue")),
    ).toEqual({ sales: "me" });
  });

  it("別のタイミングを押すと next を差し替える", () => {
    expect(
      queryOf(buildTimingHref(params("next=overdue"), "today")),
    ).toEqual({ next: "today" });
  });

  it("upcoming / unset が入っていても差し替えとして扱う (トグル解除にしない)", () => {
    expect(queryOf(buildTimingHref(params("next=upcoming"), "today"))).toEqual({
      next: "today",
    });
  });
});

describe("クイックフィルタが所有しない param の保持", () => {
  const others =
    "q=%E6%B8%8B%E8%B0%B7&sort=name&dir=asc&state=following&stage=%E8%AA%BF%E6%9F%BB%E6%B8%88%E3%81%BF&channel=DM%E6%8E%A8%E5%A5%A8&deal=none&appt=acquired";

  it("担当範囲チップは検索語・並び替え・絞り込みを保持する", () => {
    const q = queryOf(buildAssigneeHref(params(others), "me"));
    expect(q).toMatchObject({
      q: "渋谷",
      sort: "name",
      dir: "asc",
      state: "following",
      stage: "調査済み",
      channel: "DM推奨",
      deal: "none",
      appt: "acquired",
      sales: "me",
    });
  });

  it("対応タイミングチップも同じ param を保持する", () => {
    const q = queryOf(buildTimingHref(params(others), "overdue"));
    expect(q).toMatchObject({
      q: "渋谷",
      sort: "name",
      dir: "asc",
      state: "following",
      stage: "調査済み",
      channel: "DM推奨",
      deal: "none",
      appt: "acquired",
      next: "overdue",
    });
  });

  it("すべての param が空になったら /stores に戻す", () => {
    expect(buildAssigneeHref(params("sales=me"), "all")).toBe("/stores");
  });

  it("入力の URLSearchParams を破壊しない", () => {
    const source = params("sales=me&next=today");
    buildAssigneeHref(source, "none");
    buildTimingHref(source, "overdue");
    expect(source.toString()).toBe("sales=me&next=today");
  });
});
