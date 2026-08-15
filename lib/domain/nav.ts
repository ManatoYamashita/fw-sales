import {
  LayoutGrid,
  Store as StoreIcon,
  Search,
  GitBranch,
  Send,
  ArrowLeftRight,
  BarChart3,
  Settings,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** バッジに使うキー(NavBadgeCounts のフィールド名) */
  badgeKey?: "stores" | "research" | "pipeline" | "deals" | "handoffs";
  /**
   * 一時的にメニューを利用不可とする。`true` の場合はサイドバーで
   * グレーアウト表示しリンクを発火させない。直接 URL アクセスは
   * proxy 側で `/stores` にリダイレクトされる。
   */
  disabled?: boolean;
}

export const NAV_ITEMS: readonly NavItem[] = [
  { href: "/dashboard", label: "ダッシュボード", icon: LayoutGrid, disabled: true },
  { href: "/stores", label: "店舗一覧", icon: StoreIcon, badgeKey: "stores" },
  { href: "/research", label: "調査", icon: Search, badgeKey: "research" },
  { href: "/pipeline", label: "パイプライン", icon: GitBranch, badgeKey: "pipeline", disabled: true },
  { href: "/actions", label: "営業アクション", icon: Send, disabled: true },
  {
    href: "/handoffs",
    label: "引き継ぎ",
    icon: ArrowLeftRight,
    badgeKey: "handoffs",
    disabled: true,
  },
  { href: "/kpi", label: "KPI分析", icon: BarChart3, disabled: true },
  { href: "/settings", label: "設定", icon: Settings },
];

/**
 * 直接 URL アクセスをブロックする disabled ルートの定義は
 * `lib/domain/nav-routes.ts` を単一の真実とする。
 *
 * `proxy.ts` は lucide-react を巻き込まないために nav-routes.ts を直接参照するが、
 * 従来この経路から import していた利用側のために、ここでも re-export しておく。
 * `NAV_ITEMS[].disabled` との一致は `__tests__/nav-routes.test.ts` が保証する。
 */
export {
  DISABLED_ROUTE_PREFIXES,
  FALLBACK_ENABLED_ROUTE,
  isDisabledPath,
} from "./nav-routes";
