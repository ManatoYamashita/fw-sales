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
}

export const NAV_ITEMS: readonly NavItem[] = [
  { href: "/dashboard", label: "ダッシュボード", icon: LayoutGrid },
  { href: "/stores", label: "店舗一覧", icon: StoreIcon, badgeKey: "stores" },
  { href: "/research", label: "調査キュー", icon: Search, badgeKey: "research" },
  { href: "/pipeline", label: "パイプライン", icon: GitBranch, badgeKey: "pipeline" },
  { href: "/actions", label: "営業アクション", icon: Send },
  { href: "/deals", label: "商談管理", icon: Handshake, badgeKey: "deals" },
  {
    href: "/handoffs",
    label: "引き継ぎ",
    icon: ArrowLeftRight,
    badgeKey: "handoffs",
  },
  { href: "/kpi", label: "KPI分析", icon: BarChart3 },
  { href: "/settings", label: "設定", icon: Settings },
];
