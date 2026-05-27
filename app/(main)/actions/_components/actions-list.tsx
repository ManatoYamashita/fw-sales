import Link from "next/link";
import { cacheTag } from "next/cache";
import { connection } from "next/server";
import { Send } from "lucide-react";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ChannelBadge } from "@/components/feature/channel-badge";
import { StageBadge } from "@/components/feature/stage-badge";
import { repos } from "@/lib/repositories";
import { CACHE_TAGS } from "@/lib/cache";
import { ACTION_READY_STAGES } from "@/lib/domain/stages";

async function loadActionableStores() {
  "use cache";
  cacheTag(CACHE_TAGS.stores, CACHE_TAGS.actionQueue);
  const all = await repos.store.list();
  return all.filter((s) =>
    (ACTION_READY_STAGES as readonly string[]).includes(s.stage),
  );
}

export async function ActionsList() {
  // build 時 prerender を skip し runtime のみで実行する。
  // Vercel build → Supabase 接続が 50s timeout を超える USE_CACHE_TIMEOUT
  // 事象への対処 (Next.js 16 cacheComponents の公式推奨 pattern)。
  await connection();
  const stores = await loadActionableStores();
  return (
    <Card>
      <Card.Header>
        <Card.Title>アクション対象店舗</Card.Title>
        <span className="text-sm text-muted-foreground">{stores.length} 件</span>
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
        <ul className="divide-y divide-border/60">
          {stores.map((s) => (
            <li key={s.id}>
              <Link
                href={`/actions/${s.id}`}
                className="flex flex-wrap items-center gap-3 px-5 py-3 hover:bg-muted/40 transition-colors"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-foreground">
                    {s.name}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">
                    {[s.prefecture, s.city, s.genre]
                      .filter(Boolean)
                      .join(" / ")}
                  </p>
                </div>
                <StageBadge stage={s.stage} />
                <ChannelBadge channel={s.channel} />
                <span className="inline-flex h-9 items-center px-3 rounded-md text-xs font-medium bg-primary text-primary-foreground">
                  アクションへ
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export function ActionsListSkeleton() {
  return (
    <Card>
      <Card.Header>
        <Card.Title>アクション対象店舗</Card.Title>
      </Card.Header>
      <Card.Body>
        <div className="h-32 bg-muted rounded animate-pulse" />
      </Card.Body>
    </Card>
  );
}
