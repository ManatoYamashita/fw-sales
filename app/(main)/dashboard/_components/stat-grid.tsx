import { cacheLife, cacheTag } from "next/cache";
import { connection } from "next/server";
import {
  Store as StoreIcon,
  Search,
  Mail,
  Phone,
  MessageSquare,
  JapaneseYen,
} from "lucide-react";
import { Stat } from "@/components/ui/stat";
import { formatYen } from "@/lib/utils/format";
import { getDashboardStats } from "@/lib/queries/stats";
import { CACHE_TAGS } from "@/lib/cache";

async function loadStats() {
  "use cache";
  cacheLife("longBackstop");
  cacheTag(CACHE_TAGS.stats, CACHE_TAGS.stores, CACHE_TAGS.handoffs);
  return getDashboardStats();
}

export async function StatGrid() {
  // build 時 prerender を skip (USE_CACHE_TIMEOUT 対策)。
  await connection();
  const stats = await loadStats();
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
      <Stat
        label="登録店舗"
        value={stats.total}
        icon={<StoreIcon />}
        tone="default"
      />
      <Stat
        label="調査待ち"
        value={stats.waitResearch}
        icon={<Search />}
        tone="warning"
        sub="未着手の店舗数"
      />
      <Stat
        label="DM推奨"
        value={stats.dm}
        icon={<Mail />}
        tone="primary"
      />
      <Stat
        label="テレアポ推奨"
        value={stats.tel}
        icon={<Phone />}
        tone="primary"
      />
      <Stat
        label="接触済み"
        value={stats.contacted}
        icon={<MessageSquare />}
      />
      <Stat
        label="累計初期売上"
        value={formatYen(stats.totalRevenue)}
        icon={<JapaneseYen />}
        tone="success"
        sub={`月額 ${formatYen(stats.monthlyRev)} 進行中`}
      />
    </div>
  );
}

export function StatGridSkeleton() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          className="h-[112px] rounded-lg bg-card border border-border animate-pulse"
        />
      ))}
    </div>
  );
}
