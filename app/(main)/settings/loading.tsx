import { Skeleton } from "@/components/ui/skeleton";
import { CountsGridSkeleton } from "./_components/counts-grid";

export default function SettingsLoading() {
  return (
    <div className="space-y-4 max-w-4xl">
      <Skeleton className="h-7 w-24" />
      {/* 件数カードは page.tsx の Suspense fallback と同じものを使う。
          高さと列ラダーを写経すると、片方だけ古くなって跳ねる (#265)。 */}
      <CountsGridSkeleton />
      <Skeleton className="h-40 w-full" />
    </div>
  );
}
