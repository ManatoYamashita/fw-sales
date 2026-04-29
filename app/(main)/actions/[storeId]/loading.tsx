import { Skeleton, FormSkeleton } from "@/components/ui/skeleton";

export default function ActionsDetailLoading() {
  return (
    <div className="space-y-4 max-w-5xl mx-auto">
      <div>
        <Skeleton className="h-3 w-32" />
        <Skeleton className="h-7 w-40 mt-2" />
      </div>
      <Skeleton className="h-32 w-full" />
      <Skeleton className="h-64 w-full" />
      <FormSkeleton groups={1} />
    </div>
  );
}
