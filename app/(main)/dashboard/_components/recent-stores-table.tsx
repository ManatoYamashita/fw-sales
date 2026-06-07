import { cacheLife, cacheTag } from "next/cache";
import { connection } from "next/server";
import { Card } from "@/components/ui/card";
import { repos } from "@/lib/repositories";
import { CACHE_TAGS } from "@/lib/cache";
import type { Store } from "@/types/store";
import { RecentStoresTableView } from "./recent-stores-table-view";

async function loadRecentStores(): Promise<Store[]> {
  "use cache";
  cacheLife("longBackstop");
  cacheTag(CACHE_TAGS.stores);
  const all = await repos.store.list();
  return all.slice(0, 5);
}

export async function RecentStoresTable() {
  // build 時 prerender を skip (USE_CACHE_TIMEOUT 対策)。
  await connection();
  const rows = await loadRecentStores();
  return <RecentStoresTableView rows={rows} />;
}

export function RecentStoresTableSkeleton() {
  return (
    <Card>
      <Card.Header>
        <Card.Title>最近登録した店舗</Card.Title>
      </Card.Header>
      <Card.Body>
        <div className="h-40 bg-muted rounded animate-pulse" />
      </Card.Body>
    </Card>
  );
}
