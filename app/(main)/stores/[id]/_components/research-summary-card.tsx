import Link from "next/link";
import { cacheTag } from "next/cache";
import { Search } from "lucide-react";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { repos } from "@/lib/repositories";
import { CACHE_TAGS } from "@/lib/cache";

async function loadResearchByStore(storeId: string) {
  "use cache";
  cacheTag(CACHE_TAGS.researchByStore(storeId), CACHE_TAGS.research);
  return repos.research.getByStoreId(storeId);
}

export async function ResearchSummaryCard({ storeId }: { storeId: string }) {
  const research = await loadResearchByStore(storeId);
  if (!research) {
    return (
      <Card>
        <Card.Header>
          <Card.Title>調査</Card.Title>
        </Card.Header>
        <Card.Body>
          <EmptyState
            icon={<Search />}
            title="調査結果はまだありません"
            action={
              <Link
                href={`/research/${storeId}`}
                className="inline-flex h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm items-center"
              >
                調査を開始
              </Link>
            }
          />
        </Card.Body>
      </Card>
    );
  }
  return (
    <Card>
      <Card.Header>
        <Card.Title>調査結果</Card.Title>
        <Link
          href={`/research/${storeId}`}
          className="text-sm font-medium text-blue-700 hover:text-blue-800"
        >
          詳細・編集 →
        </Link>
      </Card.Header>
      <Card.Body className="space-y-3">
        <div>
          <p className="text-xs font-semibold text-muted-foreground">営業フック</p>
          <p className="text-sm text-foreground mt-1 leading-6">
            {research.sales_hook || "—"}
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <p className="text-xs font-semibold text-muted-foreground">
              入口商品
            </p>
            <p className="text-sm text-foreground mt-1">
              {research.entry_product || "—"}
            </p>
          </div>
          <div>
            <p className="text-xs font-semibold text-muted-foreground">
              本命商品
            </p>
            <p className="text-sm text-foreground mt-1">
              {research.main_product || "—"}
            </p>
          </div>
        </div>
      </Card.Body>
    </Card>
  );
}
