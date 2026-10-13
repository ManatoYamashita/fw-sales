import { FormSkeleton, Skeleton } from "@/components/ui/skeleton";

/** 店舗編集の骨組み。戻るリンク・見出し・フォームの順 (#326)。 */
export default function StoreEditLoading() {
  return (
    <div className="space-y-4 max-w-4xl mx-auto">
      <div>
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-7 w-36 mt-2" />
      </div>
      <FormSkeleton groups={3} />
    </div>
  );
}
