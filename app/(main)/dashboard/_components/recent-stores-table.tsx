import { cacheLife, cacheTag } from "next/cache";
import { Card } from "@/components/ui/card";
import { repos } from "@/lib/repositories";
import { CACHE_TAGS } from "@/lib/cache";
import type { Store } from "@/types/store";
import { RecentStoresTableView } from "./recent-stores-table-view";
import { resolveTenantId } from "@/lib/tenant/context";

async function loadRecentStores(tenantId: string): Promise<Store[]> {
  "use cache";
  cacheLife("longBackstop");
  cacheTag(CACHE_TAGS.stores(tenantId));
  const all = await repos.forTenant(tenantId).store.list();
  return all.slice(0, 5);
}

export async function RecentStoresTable() {
  const tenantId = await resolveTenantId();
  const rows = await loadRecentStores(tenantId);
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
