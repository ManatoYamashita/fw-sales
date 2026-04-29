import type { Metadata } from "next";
import { cacheTag } from "next/cache";
import { Card } from "@/components/ui/card";
import { Stat } from "@/components/ui/stat";
import { DataActions } from "./_components/data-actions";
import { repos } from "@/lib/repositories";
import { CACHE_TAGS } from "@/lib/cache";
import { Store as StoreIcon, Search, Handshake, ArrowLeftRight } from "lucide-react";

export const metadata: Metadata = { title: "設定" };

async function loadCounts() {
  "use cache";
  cacheTag(
    CACHE_TAGS.stores,
    CACHE_TAGS.research,
    CACHE_TAGS.deals,
    CACHE_TAGS.handoffs,
  );
  const [stores, research, deals, handoffs] = await Promise.all([
    repos.store.list(),
    repos.research.list(),
    repos.deal.list(),
    repos.handoff.list(),
  ]);
  return {
    stores: stores.length,
    research: research.length,
    deals: deals.length,
    handoffs: handoffs.length,
  };
}

export default async function SettingsPage() {
  const counts = await loadCounts();
  return (
    <div className="space-y-4 max-w-4xl">
      <div>
        <h2 className="text-xl md:text-2xl font-bold text-slate-900">設定</h2>
        <p className="text-sm text-slate-500 mt-1">
          データの保持状況とエクスポート/インポートを管理します。
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="店舗" value={counts.stores} icon={<StoreIcon />} />
        <Stat label="調査" value={counts.research} icon={<Search />} />
        <Stat label="商談" value={counts.deals} icon={<Handshake />} />
        <Stat
          label="引き継ぎ"
          value={counts.handoffs}
          icon={<ArrowLeftRight />}
        />
      </div>

      <DataActions />

      <Card>
        <Card.Header>
          <Card.Title>備考</Card.Title>
        </Card.Header>
        <Card.Body className="space-y-2 text-sm text-slate-600 leading-6">
          <p>
            現状はサーバ側インメモリストア(プロセス共有)で動作しています。
            プロセスを再起動するとシードデータに戻ります。
          </p>
          <p>
            将来 PostgreSQL/Drizzle 等の永続層に差し替える場合は、
            <code className="px-1 py-0.5 mx-1 rounded bg-slate-100 text-xs">
              lib/repositories/index.ts
            </code>
            の export を切り替えるだけで対応できます。
          </p>
        </Card.Body>
      </Card>
    </div>
  );
}
