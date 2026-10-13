import { FormSkeleton, Skeleton } from "@/components/ui/skeleton";

/** 店舗登録の骨組み。見出し・登録方法のタブ・フォームの順 (#326)。 */
export default function StoreNewLoading() {
  return (
    <div className="space-y-4 max-w-4xl mx-auto">
      <div>
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-4 w-80 max-w-full mt-2" />
      </div>
      <div className="flex justify-center gap-2">
        <Skeleton shape="pill" className="h-9 w-20" />
        <Skeleton shape="pill" className="h-9 w-28" />
        <Skeleton shape="pill" className="h-9 w-36" />
      </div>
      <FormSkeleton groups={2} />
    </div>
  );
}
