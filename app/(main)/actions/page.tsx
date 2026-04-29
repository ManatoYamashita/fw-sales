import Link from "next/link";
import type { Metadata } from "next";
import { cacheTag } from "next/cache";
import { Send } from "lucide-react";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ChannelBadge } from "@/components/feature/channel-badge";
import { StageBadge } from "@/components/feature/stage-badge";
import { PriorityBadge } from "@/components/feature/priority-badge";
import { repos } from "@/lib/repositories";
import { CACHE_TAGS } from "@/lib/cache";

export const metadata: Metadata = { title: "営業アクション" };

const ACTION_STAGES = [
  "調査完了",
  "一次接触準備",
  "DM送信済み",
  "テレアポ済み",
  "反応あり",
] as const;

async function loadActionableStores() {
  "use cache";
  cacheTag(CACHE_TAGS.stores, CACHE_TAGS.actionQueue);
  const all = await repos.store.list();
  return all.filter((s) =>
    (ACTION_STAGES as readonly string[]).includes(s.stage),
  );
}

export default async function ActionsPage() {
  const stores = await loadActionableStores();
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl md:text-2xl font-bold text-slate-900">
          営業アクション
        </h2>
        <p className="text-sm text-slate-500 mt-1">
          DM・テレアポ・反応待ちの店舗から次のアクションを選びます。
        </p>
      </div>
      <Card>
        <Card.Header>
          <Card.Title>アクション対象店舗</Card.Title>
          <span className="text-sm text-slate-500">{stores.length} 件</span>
        </Card.Header>
        {stores.length === 0 ? (
          <Card.Body>
            <EmptyState
              icon={<Send />}
              title="アクション待ちの店舗はありません"
              description="調査が完了した店舗がここに並びます。"
            />
          </Card.Body>
        ) : (
          <ul className="divide-y divide-slate-100">
            {stores.map((s) => (
              <li key={s.id}>
                <Link
                  href={`/actions/${s.id}`}
                  className="flex flex-wrap items-center gap-3 px-5 py-3 hover:bg-slate-50 transition-colors"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-slate-900">
                      {s.name}
                    </p>
                    <p className="text-xs text-slate-500 truncate">
                      {[s.prefecture, s.city, s.genre]
                        .filter(Boolean)
                        .join(" / ")}
                    </p>
                  </div>
                  <PriorityBadge priority={s.priority} />
                  <StageBadge stage={s.stage} />
                  <ChannelBadge channel={s.channel} />
                  <span className="inline-flex h-9 items-center px-3 rounded-md text-xs font-medium bg-slate-900 text-white">
                    アクションへ
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
