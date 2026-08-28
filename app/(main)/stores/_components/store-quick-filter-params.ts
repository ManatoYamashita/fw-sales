/**
 * 店舗一覧のクイックフィルタ (2 軸) の URL param ロジック。
 *
 * UI は `store-quick-filters.tsx`。URL 構築規則だけをこちらに分離している。
 *
 * React / next/navigation に一切依存しない純粋関数として切り出し、
 * Testing Library なしで単体テストできるようにする
 * (`store-delete-confirm-dialog.test.ts` と同規約)。
 *
 * ## 2 軸である理由
 * 「担当範囲」と「対応タイミング」は**別の軸**であり、両立する。
 *
 * - 担当範囲 … `sales` のみを所有。すべて / 自分の担当 / 未担当 の排他選択。
 * - 対応タイミング … `next` のみを所有。期限超過 / 今日 のトグル。
 *
 * 片方の軸を操作しても、もう片方が所有する param には**触らない**。
 * これにより `?sales=me&next=overdue` (自分の担当かつ期限超過) が 2 クリックで作れる。
 * 検索語 (`q`) や並び替え (`sort` / `dir`)、絞り込みパネル由来の param
 * (`state` / `stage` / `channel` / `deal` / `appt`) もすべて保持する。
 *
 * クイックフィルタは新しい `view` パラメータを導入せず、
 * 既存の `SalesProgressFilter` の semantics の shortcut として実装する。
 */

/** 担当範囲の軸。`sales` param のみを所有する。 */
export type AssigneeScope = "all" | "me" | "none";

/** 対応タイミングの軸。`next` param のみを所有する。 */
export type TimingScope = "overdue" | "today";

export const ASSIGNEE_SCOPES: readonly AssigneeScope[] = ["all", "me", "none"];
export const TIMING_SCOPES: readonly TimingScope[] = ["overdue", "today"];

export const ASSIGNEE_SCOPE_LABELS: Record<AssigneeScope, string> = {
  all: "すべて",
  me: "自分の担当",
  none: "未担当",
};

export const TIMING_SCOPE_LABELS: Record<TimingScope, string> = {
  overdue: "期限超過",
  today: "今日",
};

/** クイックフィルタが所有する param。片方の軸の操作で他方を消さないための単一の真実。 */
const ASSIGNEE_PARAM = "sales";
const TIMING_PARAM = "next";

export interface QuickFilterState {
  /** 特定担当者 (`sales=<UUID>`) が選ばれている場合は null。下記参照。 */
  assignee: AssigneeScope | null;
  /** どちらのタイミングも選ばれていない (= `next` 未指定 / upcoming / unset) 場合は null。 */
  timing: TimingScope | null;
}

/**
 * 現在の URL から各軸の選択状態を読む。
 *
 * どちらの軸も、**クイックフィルタで表現できない値が入っている場合は null を返す**。
 * 絞り込みパネルからしか設定できない状態 (`sales=<UUID>` で特定担当者を選ぶ /
 * `next=upcoming` / `next=unset`) を「どれか一つのチップが選ばれている」と
 * 偽らないため。特に `sales=<UUID>` を「すべて」扱いにすると、実際には
 * 1 人分に絞られているのに「担当: すべて」が点灯して嘘の状態表示になる。
 * その場合の実際の絞り込み内容は `ProgressFilterBar` の適用中チップが表示する。
 */
export function readQuickFilterState(
  params: URLSearchParams,
): QuickFilterState {
  const sales = params.get(ASSIGNEE_PARAM);
  const next = params.get(TIMING_PARAM);
  return {
    assignee: !sales
      ? "all"
      : sales === "me" || sales === "none"
        ? sales
        : null,
    timing: next === "overdue" || next === "today" ? next : null,
  };
}

/** `URLSearchParams` を非破壊で複製して mutate する共通処理。 */
function withParams(
  params: URLSearchParams,
  mutate: (next: URLSearchParams) => void,
): string {
  const next = new URLSearchParams(params.toString());
  mutate(next);
  const qs = next.toString();
  return qs ? `/stores?${qs}` : "/stores";
}

/**
 * 担当範囲チップの遷移先。
 * `next` を含む他のすべての param を保持する (軸をまたいで消さない)。
 */
export function buildAssigneeHref(
  params: URLSearchParams,
  scope: AssigneeScope,
): string {
  return withParams(params, (next) => {
    if (scope === "all") next.delete(ASSIGNEE_PARAM);
    else next.set(ASSIGNEE_PARAM, scope);
  });
}

/**
 * 対応タイミングチップの遷移先。
 * 選択中のチップをもう一度押すと `next` だけを落とす (トグル)。
 * `sales` を含む他のすべての param を保持する。
 */
export function buildTimingHref(
  params: URLSearchParams,
  scope: TimingScope,
): string {
  const active = readQuickFilterState(params).timing === scope;
  return withParams(params, (next) => {
    if (active) next.delete(TIMING_PARAM);
    else next.set(TIMING_PARAM, scope);
  });
}
