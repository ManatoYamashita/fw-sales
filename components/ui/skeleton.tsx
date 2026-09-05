import { cn } from "@/lib/utils/cn";

export function Skeleton({
  className,
  tone = "muted",
}: {
  className?: string;
  tone?: "muted" | "card";
}) {
  return (
    <div
      className={cn(
        "animate-pulse rounded-md",
        tone === "card" ? "bg-card" : "bg-muted",
        className,
      )}
      aria-hidden
    />
  );
}

export function TableSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="bg-card text-card-foreground border border-border rounded-lg shadow-card overflow-hidden">
      <div className="px-5 py-4 border-b border-border">
        <Skeleton className="h-5 w-32" />
      </div>
      <div className="divide-y divide-border/60">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="px-5 py-3 flex items-center gap-4">
            <Skeleton className="h-4 flex-1" />
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-5 w-16" />
            <Skeleton className="h-5 w-20" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function FormSkeleton({ groups = 3 }: { groups?: number }) {
  return (
    <div className="space-y-4">
      {Array.from({ length: groups }).map((_, g) => (
        <div
          key={g}
          className="bg-card text-card-foreground border border-border rounded-lg shadow-card p-5 space-y-4"
        >
          <Skeleton className="h-5 w-32" />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="space-y-1.5">
                <Skeleton className="h-3 w-16" />
                <Skeleton className="h-9 w-full" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function KanbanSkeleton({ columns = 6 }: { columns?: number }) {
  return (
    <div className="flex gap-3 overflow-x-auto pb-4 -mx-4 md:-mx-6 px-4 md:px-6">
      {Array.from({ length: columns }).map((_, c) => (
        <div
          key={c}
          className="w-72 shrink-0 rounded-lg bg-muted/40 border border-border flex flex-col h-[360px]"
        >
          <div className="flex items-center justify-between px-3 py-2 border-b border-border">
            <Skeleton className="h-5 w-20" />
            <Skeleton className="h-4 w-6" />
          </div>
          <div className="flex-1 p-2 space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full" tone="card" />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function StatGridSkeletonShared({ count = 8 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton
          key={i}
          className="h-[112px] border border-border"
          tone="card"
        />
      ))}
    </div>
  );
}
