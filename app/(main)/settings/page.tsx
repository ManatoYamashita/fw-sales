import { Suspense } from "react";
import type { Metadata } from "next";
import { cacheLife, cacheTag } from "next/cache";
import { Card } from "@/components/ui/card";
import { Stat } from "@/components/ui/stat";
import { Heading, Text } from "@/components/ui/typography";
import { DataActions } from "./_components/data-actions";
import { ThemeToggleCard } from "./_components/theme-toggle-card";
import { UserManagementCard } from "./_components/user-management-card";
import { AiPromptTemplatesCard } from "./_components/ai-prompt-templates-card";
import { GemUrlCard } from "./_components/gem-url-card";
import { repos } from "@/lib/repositories";
import { CACHE_TAGS } from "@/lib/cache";
import {
  Store as StoreIcon,
  Search,
  Handshake,
  ArrowLeftRight,
} from "lucide-react";

export const metadata: Metadata = { title: "設定" };

async function loadCounts() {
  "use cache";
  // 4テーブルを full list する最重クエリ。longBackstop だと build 時 prerender 充填が走り、
  // データ増大時に将来 USE_CACHE_TIMEOUT を招き得る。dynamicHole(expire<DYNAMIC_EXPIRE=300s)
  // で build 充填を回避し、リクエスト時充填 + 短期 runtime cache + タグ無効化で運用する。
  cacheLife("dynamicHole");
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

function CountsGridSkeleton() {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {Array.from({ length: 4 }).map((_, i) => (
        <div
          key={i}
          className="h-[88px] rounded-lg bg-card border border-border animate-pulse"
        />
      ))}
    </div>
  );
}

async function CountsGrid() {
  const counts = await loadCounts();
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      <Stat label="店舗" value={counts.stores} icon={<StoreIcon />} />
      <Stat label="調査" value={counts.research} icon={<Search />} />
      <Stat label="商談" value={counts.deals} icon={<Handshake />} />
      <Stat label="引き継ぎ" value={counts.handoffs} icon={<ArrowLeftRight />} />
    </div>
  );
}

export default function SettingsPage() {
  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <Heading level={1}>設定</Heading>
        <Text variant="muted" className="mt-1">
          データの保持状況・テーマ・エクスポート/インポートを管理します。
        </Text>
      </div>

      {/* 件数は最重クエリのため dynamic-hole + Suspense で静的シェルから切り離す。 */}
      <Suspense fallback={<CountsGridSkeleton />}>
        <CountsGrid />
      </Suspense>

      <ThemeToggleCard />

      <DataActions />

      {/* admin のみ表示。getCurrentProfile() で cookies を読むため隔離 (#155)。 */}
      <Suspense fallback={null}>
        <UserManagementCard />
      </Suspense>

      {/* getCurrentSession() で cookies を読む動的コンポーネント。静的シェルを保つため隔離。 */}
      <Suspense fallback={null}>
        <AiPromptTemplatesCard />
      </Suspense>

      {/* Gem URL 設定 (Issue #122)。getGemUrlCached は 'use cache' で cookies 非依存。 */}
      <GemUrlCard />

      <Card>
        <Card.Header>
          <Card.Title>備考</Card.Title>
        </Card.Header>
        <Card.Body className="space-y-2 text-sm text-muted-foreground leading-relaxed">
          <p>
            このプロジェクトは現在開発中です。一部モックデータを使用していることにご注意ください。
          </p>
        </Card.Body>
      </Card>
    </div>
  );
}
