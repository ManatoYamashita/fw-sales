import { Skeleton, StatGridSkeletonShared } from "@/components/ui/skeleton";

export default function KpiLoading() {
  return (
    <div className="space-y-4">
      <div>
        <Skeleton className="h-7 w-32" />
        <Skeleton className="h-4 w-72 mt-2" />
      </div>
      <StatGridSkeletonShared count={2} />
      <Skeleton className="h-72 w-full" />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Skeleton className="h-72 w-full" />
        <Skeleton className="h-72 w-full" />
      </div>
    </div>
  );
}
