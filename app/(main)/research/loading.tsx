import { Skeleton, TableSkeleton } from "@/components/ui/skeleton";

export default function ResearchLoading() {
  return (
    <div className="space-y-4">
      <div>
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-4 w-72 mt-2" />
      </div>
      <div className="flex gap-2 border-b border-border">
        <Skeleton className="h-9 w-28" />
        <Skeleton className="h-9 w-28" />
        <Skeleton className="h-9 w-28" />
      </div>
      <TableSkeleton rows={4} />
    </div>
  );
}
