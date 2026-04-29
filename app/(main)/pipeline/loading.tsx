import { Skeleton, KanbanSkeleton } from "@/components/ui/skeleton";

export default function PipelineLoading() {
  return (
    <div className="space-y-4">
      <div>
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-4 w-72 mt-2" />
      </div>
      <Skeleton className="h-14 w-full" />
      <KanbanSkeleton columns={6} />
    </div>
  );
}
