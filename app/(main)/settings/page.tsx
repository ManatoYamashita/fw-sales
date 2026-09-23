import { Suspense } from "react";
import type { Metadata } from "next";
import { cacheLife, cacheTag } from "next/cache";
import { Card } from "@/components/ui/card";
import { Stat } from "@/components/ui/stat";
import { Heading, Text } from "@/components/ui/typography";
import {
  COUNTS_GRID_CLASS,
  CountsGridSkeleton,
} from "./_components/counts-grid";
import { DataActions } from "./_components/data-actions";
import { ThemeToggleCard } from "./_components/theme-toggle-card";
import { UserManagementCard } from "./_components/user-management-card";
import { AiPromptTemplatesCard } from "./_components/ai-prompt-templates-card";
import { KeepaliveStatusCard } from "./_components/keepalive-status-card";
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
  // 3テーブルを full list する最重クエリ。longBackstop だと build 時 prerender 充填が走り、
  // データ増大時に将来 USE_CACHE_TIMEOUT を招き得る。
  // dynamicHole(expire<MIN_PRERENDERABLE_EXPIRE=300s。16.2 までの名称は DYNAMIC_EXPIRE)
  // で build 充填を回避し、リクエスト時充填 + 短期 runtime cache + タグ無効化で運用する。
  //
  // Issue #110: 旧 `research` テーブル撤去に伴い、「調査」カードは AI 店舗調査の
  // run 総数 (`store_research_runs`) に差し替えた。件数は行を全件ロードせず
  // `count(*)` で取る。run の作成・完了は `startResearchRunAction` 等が
  // `CACHE_TAGS.stores` を revalidate するため、下のタグで失効が届く。
  cacheLife("dynamicHole");
  cacheTag(CACHE_TAGS.stores, CACHE_TAGS.deals, CACHE_TAGS.handoffs);
  const [stores, researchRuns, deals, handoffs] = await Promise.all([
    repos.store.list(),
    repos.researchRun.count(),
    repos.deal.list(),
    repos.handoff.list(),
  ]);
  return {
    stores: stores.length,
    researchRuns,
    deals: deals.length,
    handoffs: handoffs.length,
  };
}

async function CountsGrid() {
  const counts = await loadCounts();
  return (
    <div className={COUNTS_GRID_CLASS}>
      <Stat label="店舗" value={counts.stores} icon={<StoreIcon />} />
      <Stat label="AI調査" value={counts.researchRuns} icon={<Search />} />
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

      {/* app_settings を 1 行読む動的コンポーネント。静的シェルを保つため隔離。 */}
      <Suspense fallback={null}>
        <KeepaliveStatusCard />
      </Suspense>

      <Card>
        <Card.Header>
          <Card.Title>クレジットとヴァージョン情報</Card.Title>
        </Card.Header>
        <Card.Body>
          <dl className="space-y-2 text-sm leading-relaxed">
            <div>
              <dt className="inline font-medium text-foreground">version:</dt>{" "}
              <dd className="inline text-muted-foreground">1.0.1</dd>
            </div>
            <div>
              <dt className="inline font-medium text-foreground">開発:</dt>{" "}
              <dd className="inline text-muted-foreground">新卒グルメ</dd>
            </div>
            <div>
              <dt className="inline font-medium text-foreground">開発者:</dt>{" "}
              <dd className="inline break-words text-muted-foreground">
                mail@yamashitamana.to
              </dd>
            </div>
            <div>
              <dt className="inline font-medium text-foreground">
                コントリビューター:
              </dt>{" "}
              <dd className="inline break-words text-muted-foreground">
                ohisama.shu@gmail.com
              </dd>
            </div>
            <div>
              <dt className="inline font-medium text-foreground">コピーライト:</dt>{" "}
              <dd className="inline text-muted-foreground">
                ©{" "}
                <a
                  href="https://firstweb-works.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-foreground underline underline-offset-2 transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
                >
                  Firstweb
                </a>{" "}/{" "}
                <a
                  href="https://www.instagram.com/syokufun_gen/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-foreground underline underline-offset-2 transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
                >
                  新卒グルメ
                </a>
              </dd>
            </div>
          </dl>
        </Card.Body>
      </Card>
    </div>
  );
}
