import type { Metadata } from "next";
import { cacheTag } from "next/cache";
import { connection } from "next/server";
import { Card } from "@/components/ui/card";
import { Stat } from "@/components/ui/stat";
import { Heading, Text } from "@/components/ui/typography";
import { DataActions } from "./_components/data-actions";
import { ThemeToggleCard } from "./_components/theme-toggle-card";
import { AiPromptTemplatesCard } from "./_components/ai-prompt-templates-card";
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
  // build 時 prerender を skip (USE_CACHE_TIMEOUT 対策)。
  await connection();
  const counts = await loadCounts();
  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <Heading level={1}>設定</Heading>
        <Text variant="muted" className="mt-1">
          データの保持状況・テーマ・エクスポート/インポートを管理します。
        </Text>
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

      <ThemeToggleCard />

      <DataActions />

      <AiPromptTemplatesCard />

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
