import { Skeleton, FormSkeleton } from "@/components/ui/skeleton";

export default function DealDetailLoading() {
  return (
    <div className="space-y-4 max-w-4xl mx-auto">
      <Skeleton className="h-7 w-48" />
      <FormSkeleton groups={2} />
    </div>
  );
}
