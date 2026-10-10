import { Skeleton, TableSkeleton } from "@/components/ui/skeleton";

/**
 * `(main)` 配下で専用の loading.tsx を持たない画面の受け皿。
 *
 * 一覧画面が大半なので、見出しと表の骨組みを出す。スピナーと文言だけの表示は
 * 「何が出てくるか」が分からず固まって見えるため使わない (#326)。
 */
export default function MainLoading() {
  return (
    <div className="space-y-4">
      <div>
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-4 w-72 mt-2" />
      </div>
      <TableSkeleton rows={6} />
    </div>
  );
}
