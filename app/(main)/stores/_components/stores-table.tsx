import { listSalesProgressRows } from "@/lib/queries/sales-progress";
import { getCurrentProfile } from "@/lib/supabase/server";
import {
  hasAnyProgressFilter,
  type ProgressSort,
  type SalesProgressFilter,
} from "@/lib/domain/sales-progress";
import { StoresTableView } from "./stores-table-view";

/**
 * `sales=me` が未解決のままドメインへ届いたときに使う非一致プレースホルダ。
 *
 * `assigned_sales_user_id` は UUID なのでこの文字列とは決して一致せず、結果は空になる。
 * **`"none"` (未担当) にフォールバックしてはいけない**: 「自分の担当」を開いたはずが
 * 黙って「未担当一覧」に化けるのが最悪の壊れ方で、空表示のほうが安全側に倒れる。
 */
const NO_SESSION_SALES_SENTINEL = "__no-session__";

/**
 * 店舗一覧の Server Component shell。
 *
 * `cell` / `title` / `rowKey` / `rowHref` などの関数を column 定義に含む
 * `DataTable` (`"use client"`) は RSC 境界で関数を受け取れない
 * (Next.js 16 / React 19 の serialization 制約)。
 * 本コンポーネントはデータ取得のみを担い、レンダリングは
 * `StoresTableView` (`"use client"`) に委譲する。
 *
 * task 4.2 (PR3a): listActiveDeepResearchStoreIds 撤去 (#121 / #110 連動)。
 *
 * 営業担当 (sales) ソートに必要な profile.display_name の解決は
 * `listSalesProgressRows` の内部で完結する (props 経由では受け取らない)。
 * profiles を引数で渡す形にすると、渡し忘れたときに全行の salesName が null になり
 * sales ソートが無言で壊れるため。
 *
 * ## セッションを読む理由と安全性
 * 本コンポーネントは 2 つの用途でセッションを 1 回だけ読む。
 *
 * 1. クイックフィルタの `sales=me` を実ユーザー UUID へ解決する。
 *    `page.tsx` 本体は静的シェルを保つため意図的に cookies を読まない (#106 / #107) ので、
 *    解決は Suspense 境界の内側にある本コンポーネントの責務になる。
 * 2. 一括削除 / 個別削除 UI の表示可否 (`canBulkDelete` / `canDelete`) を**サーバで**決める。
 *    client の `useIsAdmin().loaded` を待つ方式だと、初期描画後にチェックボックス列が
 *    出現してテーブルが横にずれる。サーバで確定させればその揺れが起きない。
 *
 * `getCurrentProfile` は 1 回の呼び出しで userId (`profile.id`) と role の両方を返すため、
 * セッション取得は 1 回で済む。キャッシュ版の `getProfileById` を使わないのは、
 * `pnpm db:set-role` (運用スクリプト) が DB を直接更新して `updateTag` を発火しないため、
 * role が最大 6h 古いまま残りうるから。サイドバーが「管理者」と表示しているのに
 * 削除 UI だけ消えている、という食い違いを避ける。
 *
 * `getCurrentProfile` は `cookies()` を読むため Cache Components 下では Suspense 境界の
 * 内側である必要があるが、本コンポーネントは `page.tsx` の keyed Suspense 配下にあり
 * 条件を満たす (`app/(main)/layout.tsx` の `SidebarShell` と同型)。
 *
 * **UI の出し分けは認可境界ではない。** 真の防御は `deleteStoreAction` /
 * `bulkDeleteStoresAction` 側の `requireAdmin` ガードであり、そちらは一切変更しない。
 */
export async function StoresTable({
  filter,
  sort,
}: {
  filter: SalesProgressFilter;
  sort: ProgressSort;
}) {
  const profile = await getCurrentProfile();
  const isAdmin = profile?.role === "admin";

  const resolvedFilter: SalesProgressFilter =
    filter.sales === "me"
      ? { ...filter, sales: profile?.id ?? NO_SESSION_SALES_SENTINEL }
      : filter;

  const rows = await listSalesProgressRows(resolvedFilter, sort);
  return (
    <StoresTableView
      rows={rows}
      canDelete={isAdmin}
      // 狭幅ではソート中の列を隠さないための情報 (#220 要件5)。
      // client で useSearchParams を読むと静的シェルが壊れるので、
      // page.tsx が既にサーバで確定させた sort をそのまま下ろす。
      activeSortKey={sort.key}
      activeSortDir={sort.dir}
      // 0 件だったときに「条件に一致しない」と「店舗がまだ無い」を言い分けるため。
      // 解決前の filter を見る (`sales=me` は解決の前後でキーの有無が変わらない)。
      isFiltered={hasAnyProgressFilter(filter)}
    />
  );
}
