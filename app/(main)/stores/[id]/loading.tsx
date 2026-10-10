import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * 店舗詳細の骨組み。戻るリンク・店舗名とバッジ・タブ・カードの順で、
 * page.tsx と StoreDetailTabs の並びに合わせる (#326)。
 */
export default function StoreLoading() {
  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <Skeleton className="h-4 w-20" />
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Skeleton className="h-8 w-64" />
          <Skeleton shape="pill" className="h-5 w-16" />
          <Skeleton shape="pill" className="h-5 w-20" />
        </div>
        <Skeleton className="h-4 w-40" />
      </div>
      <div className="flex gap-2">
        <Skeleton shape="pill" className="h-9 w-24" />
        <Skeleton shape="pill" className="h-9 w-24" />
        <Skeleton shape="pill" className="h-9 w-24" />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {Array.from({ length: 2 }).map((_, i) => (
          <Card key={i}>
            <Card.Header>
              <Skeleton className="h-5 w-32" />
            </Card.Header>
            <Card.Body className="space-y-3">
              {Array.from({ length: 5 }).map((__, j) => (
                <div key={j} className="flex items-center gap-4">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-4 flex-1" />
                </div>
              ))}
            </Card.Body>
          </Card>
        ))}
      </div>
    </div>
  );
}
