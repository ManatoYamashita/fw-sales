import { FormSkeleton, Skeleton } from "@/components/ui/skeleton";

/** 引き継ぎ作成の骨組み。戻るリンク・見出し・フォームの順 (#326)。 */
export default function HandoffNewLoading() {
  return (
    <div className="space-y-4 max-w-4xl mx-auto">
      <div>
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-7 w-48 mt-2" />
      </div>
      <FormSkeleton groups={2} />
    </div>
  );
}
