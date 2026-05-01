import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { type ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

export interface BreadcrumbItem {
  label: ReactNode;
  href?: string;
}

interface BreadcrumbProps {
  items: BreadcrumbItem[];
  className?: string;
  separator?: ReactNode;
}

export function Breadcrumb({
  items,
  className,
  separator,
}: BreadcrumbProps) {
  if (items.length === 0) return null;
  const sep = separator ?? (
    <ChevronRight
      className="h-3.5 w-3.5 text-muted-foreground/60 shrink-0"
      aria-hidden
    />
  );

  return (
    <nav aria-label="パンくずリスト" className={cn("min-w-0", className)}>
      <ol className="flex items-center gap-1.5 text-sm min-w-0">
        {items.map((item, idx) => {
          const isLast = idx === items.length - 1;
          return (
            <li
              key={`${idx}-${typeof item.label === "string" ? item.label : "node"}`}
              className="flex items-center gap-1.5 min-w-0"
            >
              {idx > 0 ? sep : null}
              {item.href && !isLast ? (
                <Link
                  href={item.href}
                  className="text-muted-foreground hover:text-foreground transition-colors truncate"
                >
                  {item.label}
                </Link>
              ) : (
                <span
                  className={cn(
                    "truncate",
                    isLast ? "text-foreground font-medium" : "text-muted-foreground",
                  )}
                  aria-current={isLast ? "page" : undefined}
                >
                  {item.label}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
