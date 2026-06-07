import Link from "next/link";
import { cacheLife, cacheTag } from "next/cache";
import { connection } from "next/server";
import { Search, Send, ArrowLeftRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { getActionQueue } from "@/lib/queries/action-queue";
import { CACHE_TAGS } from "@/lib/cache";
import type { ReactNode } from "react";
import type { Store } from "@/types/store";
import type { Handoff } from "@/types/handoff";

async function loadQueue() {
  "use cache";
  cacheLife("longBackstop");
  cacheTag(CACHE_TAGS.stores, CACHE_TAGS.handoffs, CACHE_TAGS.actionQueue);
  return getActionQueue();
}

interface SectionProps {
  icon: ReactNode;
  title: string;
  count: number;
  emptyText: string;
  children: ReactNode;
}

function Section({ icon, title, count, emptyText, children }: SectionProps) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground [&>svg]:h-4 [&>svg]:w-4">{icon}</span>
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        <span className="ml-auto text-xs font-medium text-muted-foreground">
          {count} 件
        </span>
      </div>
      {count === 0 ? (
        <p className="text-xs text-muted-foreground/70 px-1 py-2">{emptyText}</p>
      ) : (
        <ul className="space-y-1">{children}</ul>
      )}
    </div>
  );
}

function StoreItem({ store, href }: { store: Store; href: string }) {
  return (
    <li>
      <Link
        href={href}
        className="flex items-center justify-between gap-2 px-2 py-1.5 rounded-md hover:bg-muted/40 transition-colors"
      >
        <span className="text-sm text-foreground font-medium truncate">
          {store.name}
        </span>
        <span className="text-xs text-muted-foreground/70 whitespace-nowrap">
          {store.prefecture} {store.city}
        </span>
      </Link>
    </li>
  );
}

function HandoffItem({ handoff }: { handoff: Handoff }) {
  return (
    <li>
      <Link
        href={`/handoffs/${handoff.id}`}
        className="flex items-center justify-between gap-2 px-2 py-1.5 rounded-md hover:bg-muted/40 transition-colors"
      >
        <span className="text-sm text-foreground font-medium truncate">
          {handoff.store_name}
        </span>
        <span className="text-xs text-muted-foreground/70 whitespace-nowrap">
          {handoff.ops_assignee || "—"}
        </span>
      </Link>
    </li>
  );
}

export async function ActionQueue() {
  // build 時 prerender を skip (USE_CACHE_TIMEOUT 対策)。
  await connection();
  const queue = await loadQueue();
  const isEmpty =
    queue.needsResearch.length === 0 &&
    queue.needsAction.length === 0 &&
    queue.pendingHandoffs.length === 0;

  return (
    <Card>
      <Card.Header>
        <Card.Title>アクションキュー</Card.Title>
      </Card.Header>
      <Card.Body>
        {isEmpty ? (
          <EmptyState
            title="未着手アクションはありません"
            description="優秀ですねぇ。"
          />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            <Section
              icon={<Search />}
              title="調査未着手"
              count={queue.needsResearch.length}
              emptyText="未調査の店舗はありません。"
            >
              {queue.needsResearch.map((s) => (
                <StoreItem
                  key={s.id}
                  store={s}
                  href={`/research/${s.id}`}
                />
              ))}
            </Section>
            <Section
              icon={<Send />}
              title="アクション準備"
              count={queue.needsAction.length}
              emptyText="一次接触準備中の店舗はありません。"
            >
              {queue.needsAction.map((s) => (
                <StoreItem
                  key={s.id}
                  store={s}
                  href={`/actions/${s.id}`}
                />
              ))}
            </Section>
            <Section
              icon={<ArrowLeftRight />}
              title="引き継ぎ確認待ち"
              count={queue.pendingHandoffs.length}
              emptyText="運用確認待ちはありません。"
            >
              {queue.pendingHandoffs.map((h) => (
                <HandoffItem key={h.id} handoff={h} />
              ))}
            </Section>
          </div>
        )}
      </Card.Body>
    </Card>
  );
}

export function ActionQueueSkeleton() {
  return (
    <Card>
      <Card.Header>
        <Card.Title>アクションキュー</Card.Title>
      </Card.Header>
      <Card.Body>
        <div className="h-32 bg-muted rounded animate-pulse" />
      </Card.Body>
    </Card>
  );
}
