import { Skeleton, FormSkeleton } from "@/components/ui/skeleton";

export default function ResearchDetailLoading() {
  return (
    <div className="space-y-4 max-w-4xl mx-auto">
      <div>
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-7 w-32 mt-2" />
        <Skeleton className="h-4 w-72 mt-2" />
      </div>
      <FormSkeleton groups={4} />
    </div>
  );
}
