import { cacheTag } from "next/cache";
import {
  Store as StoreIcon,
  Search,
  Mail,
  Phone,
  MessageSquare,
  Briefcase,
  Trophy,
  JapaneseYen,
} from "lucide-react";
import { Stat } from "@/components/ui/stat";
import { formatYen } from "@/lib/utils/format";
import { getDashboardStats } from "@/lib/queries/stats";
import { CACHE_TAGS } from "@/lib/cache";

async function loadStats() {
  "use cache";
  cacheTag(CACHE_TAGS.stats, CACHE_TAGS.stores, CACHE_TAGS.handoffs);
  return getDashboardStats();
}

export async function StatGrid() {
  const stats = await loadStats();
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
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
        label="商談中"
        value={stats.dealsStage}
        icon={<Briefcase />}
        tone="warning"
      />
      <Stat
        label="受注"
        value={stats.orders}
        icon={<Trophy />}
        tone="success"
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
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
      {Array.from({ length: 8 }).map((_, i) => (
        <div
          key={i}
          className="h-[88px] rounded-lg bg-white border border-slate-200 animate-pulse"
        />
      ))}
    </div>
  );
}
