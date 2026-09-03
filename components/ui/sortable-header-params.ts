/**
 * ソート URL の組み立て (#234 / PR3/3)。
 *
 * `SortableHeader` (表のヘッダ) と `DataTableSortSelect` (カードモードの並び替え) の
 * **両方が同じ関数を使う**ために切り出した。片方だけ挙動が変わると、同じ画面の同じ
 * 状態を 2 通りの URL で表すことになり、共有リンクやブックマークが食い違う。
 *
 * React に依存しない純関数なので、node 環境の vitest でそのままテストできる
 * (`store-quick-filter-params.ts` と同じ規約)。
 */

export type SortDir = "asc" | "desc";

export interface SortState {
  /** 現在ソート中の列キー。未指定なら `null`。 */
  sortKey: string | null;
  /** 現在の方向。`dir` が無い / 不正な値なら `desc` に倒す (既存の挙動を保つ)。 */
  dir: SortDir;
}

/** URL クエリから現在のソート状態を読む。 */
export function readSortState(params: URLSearchParams): SortState {
  return {
    sortKey: params.get("sort"),
    dir: params.get("dir") === "asc" ? "asc" : "desc",
  };
}

/**
 * その列を選んだときに遷移すべき方向。
 *
 * - 別の列 → その列の `defaultDir`
 * - 同じ列 → 現在の方向を反転 (asc ⇄ desc)
 */
export function nextSortDir(
  sortKey: string,
  defaultDir: SortDir,
  current: SortState,
): SortDir {
  if (current.sortKey !== sortKey) return defaultDir;
  return current.dir === "asc" ? "desc" : "asc";
}

/**
 * 他のクエリ (q / stage / channel / 担当フィルタなど) を保持したまま
 * `sort` と `dir` だけを差し替えた href を返す。
 */
export function buildSortHref(
  pathname: string,
  params: URLSearchParams,
  sortKey: string,
  dir: SortDir,
): string {
  const next = new URLSearchParams(params.toString());
  next.set("sort", sortKey);
  next.set("dir", dir);
  return `${pathname}?${next.toString()}`;
}
