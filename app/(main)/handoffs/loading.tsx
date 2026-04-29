import { Skeleton, TableSkeleton } from "@/components/ui/skeleton";

export default function HandoffsLoading() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-7 w-40" />
      <TableSkeleton rows={4} />
    </div>
  );
}
