import { Skeleton, TableSkeleton } from "@/components/ui/skeleton";

export default function ActionsLoading() {
  return (
    <div className="space-y-4">
      <div>
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-4 w-80 mt-2" />
      </div>
      <TableSkeleton rows={4} />
    </div>
  );
}
