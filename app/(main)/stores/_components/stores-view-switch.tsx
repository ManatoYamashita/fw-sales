import Link from "next/link";
import { cn } from "@/lib/utils/cn";

type StoresView = "list" | "progress";

/**
 * 店舗一覧 (`/stores`) と営業進捗 (`/stores/progress`) の表示切替ピル。
 * 両ページのヘッダ行に置き、ナビ項目を増やさずに相互移動できるようにする。
 */
export function StoresViewSwitch({ active }: { active: StoresView }) {
  return (
    <nav
      aria-label="店舗ビューの切替"
      className="inline-flex items-center gap-0.5 rounded-lg border border-border bg-muted/50 p-0.5"
    >
      <ViewLink href="/stores" active={active === "list"}>
        一覧
      </ViewLink>
      <ViewLink href="/stores/progress" active={active === "progress"}>
        営業進捗
      </ViewLink>
    </nav>
  );
}

function ViewLink({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "inline-flex h-8 items-center rounded-md px-3 text-sm font-medium transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active
          ? "bg-background text-foreground shadow-card"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </Link>
  );
}
