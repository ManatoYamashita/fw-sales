import { describe, expect, it } from "vitest";
import {
  buildSortHref,
  nextSortDir,
  readSortState,
} from "../sortable-header-params";

/**
 * ソート URL 組み立ての純関数テスト (#234)。
 *
 * `SortableHeader` (表のヘッダ) と `DataTableSortSelect` (カードモード) が同じ
 * 関数を使うことで、同じ状態が 2 通りの URL で表される事故を防いでいる。
 * ここはその共有ロジックの契約。
 */

const params = (q: string) => new URLSearchParams(q);

describe("readSortState", () => {
  it("sort が無ければ null", () => {
    expect(readSortState(params(""))).toEqual({ sortKey: null, dir: "desc" });
  });

  it("dir=asc のときだけ asc、それ以外は desc に倒す", () => {
    expect(readSortState(params("sort=name&dir=asc")).dir).toBe("asc");
    expect(readSortState(params("sort=name&dir=desc")).dir).toBe("desc");
    // 不正値でも既存の挙動 (desc) を保つ
    expect(readSortState(params("sort=name&dir=sideways")).dir).toBe("desc");
    expect(readSortState(params("sort=name")).dir).toBe("desc");
  });
});

describe("nextSortDir", () => {
  it("別の列を選んだらその列の既定方向", () => {
    expect(
      nextSortDir("name", "asc", { sortKey: "stage", dir: "desc" }),
    ).toBe("asc");
    expect(
      nextSortDir("meeting", "desc", { sortKey: null, dir: "desc" }),
    ).toBe("desc");
  });

  it("同じ列なら方向を反転する", () => {
    expect(nextSortDir("name", "asc", { sortKey: "name", dir: "asc" })).toBe(
      "desc",
    );
    expect(nextSortDir("name", "asc", { sortKey: "name", dir: "desc" })).toBe(
      "asc",
    );
  });
});

describe("buildSortHref", () => {
  it("他のクエリを保持したまま sort と dir を差し替える", () => {
    // 事故: フィルタを落とすと「並び替えたら絞り込みが消えた」になる。
    const href = buildSortHref(
      "/stores",
      params("q=%E5%B1%85%E9%85%92%E5%B1%8B&stage=contacted&sort=stage&dir=asc"),
      "name",
      "desc",
    );
    const out = new URL(href, "http://x").searchParams;
    expect(out.get("q")).toBe("居酒屋");
    expect(out.get("stage")).toBe("contacted");
    expect(out.get("sort")).toBe("name");
    expect(out.get("dir")).toBe("desc");
  });

  it("sort / dir が無い URL にも付けられる", () => {
    const href = buildSortHref("/stores", params(""), "name", "asc");
    expect(href).toBe("/stores?sort=name&dir=asc");
  });

  it("pathname を保つ", () => {
    expect(buildSortHref("/stores", params(""), "x", "asc").startsWith("/stores?")).toBe(
      true,
    );
  });
});
