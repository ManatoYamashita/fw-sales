import {
  LayoutGrid,
  Store as StoreIcon,
  Search,
  GitBranch,
  Send,
  Handshake,
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
   * middleware 側で `/stores` にリダイレクトされる。
   */
  disabled?: boolean;
}

export const NAV_ITEMS: readonly NavItem[] = [
  { href: "/dashboard", label: "ダッシュボード", icon: LayoutGrid, disabled: true },
  { href: "/stores", label: "店舗一覧", icon: StoreIcon, badgeKey: "stores" },
  { href: "/research", label: "調査キュー", icon: Search, badgeKey: "research", disabled: true },
  { href: "/pipeline", label: "パイプライン", icon: GitBranch, badgeKey: "pipeline", disabled: true },
  { href: "/actions", label: "営業アクション", icon: Send, disabled: true },
  { href: "/deals", label: "商談管理", icon: Handshake, badgeKey: "deals", disabled: true },
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
 * 直接 URL アクセスをブロックする disabled ルートのプレフィクス一覧。
 * `NAV_ITEMS` の `disabled` と整合させる単一の真実とする。
 * middleware が edge runtime で参照する。
 */
export const DISABLED_ROUTE_PREFIXES: readonly string[] = NAV_ITEMS.filter(
  (item) => item.disabled,
).map((item) => item.href);

/** disabled ルートにアクセスした場合のリダイレクト先。 */
export const FALLBACK_ENABLED_ROUTE = "/stores";
