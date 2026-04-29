import { Skeleton, TableSkeleton } from "@/components/ui/skeleton";

export default function DealsLoading() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-7 w-40" />
      <TableSkeleton rows={5} />
    </div>
  );
}
