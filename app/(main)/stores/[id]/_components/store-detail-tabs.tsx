"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Edit2, MoreHorizontal } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsPanel } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils/cn";
import { BasicInfoCard } from "./basic-info-card";
import { BasicInfoFieldsCard } from "./basic-info-fields-card";
import { MapEmbedCard } from "./map-embed-card";
import { WebAssetCard } from "./web-asset-card";
import { SalesProgressCard } from "./sales-progress-card";
import { AiAnalysisDetailSection } from "./ai-analysis-detail-section";
import { StageInlineSelect } from "./stage-inline-select";
import { DeleteStoreButton } from "./delete-store-button";
import type { Store } from "@/types/store";
import type { Deal } from "@/types/deal";
import type { Profile } from "@/types/profile";

interface StoreDetailTabsProps {
  store: Store;
  profiles: readonly Profile[];
  /** 営業進捗タブ用の店舗単位の商談一覧 (最新商談の導出 + 履歴表示)。 */
  deals: readonly Deal[];
  isApiKeyConfigured: boolean;
  // task 4.2 (PR3a): deepResearchSlot / promptTemplates / hasDeepResearchReport /
  // assignedSalesName を撤去。営業資産生成は SalesAssetsGenerator に集約済み。
  // store-cascade-delete (#152): dealCount prop を撤去。削除ダイアログが
  // open 時に影響件数 (商談/調査/引き継ぎ/場所候補) を直接取得する。
}

export function StoreDetailTabs({
  store,
  profiles,
  deals,
  isApiKeyConfigured,
}: StoreDetailTabsProps) {
  const editHref = `/stores/${store.id}/edit`;

  // `?tab=ai` は AI 分析タブ、`?tab=progress` は営業進捗タブへの deep link。
  // 旧 `#deep-research` アンカーへのスクロール処理は Issue #110 で撤去した
  // (対象の DeepResearchSection が #125 で消え、常に空振りしていたため)。
  // `tab` パラメータの解釈自体はブックマーク互換のため維持する。
  const searchParams = useSearchParams();
  const tabParam = searchParams.get("tab");
  const initialTab =
    tabParam === "ai" ? "ai" : tabParam === "progress" ? "progress" : "basic";

  return (
    <Tabs defaultValue={initialTab} variant="pill">
      <div className="flex items-center gap-2 flex-wrap">
        <StageInlineSelect storeId={store.id} current={store.stage} />
        <TabsList>
          <TabsTrigger value="basic">基本情報</TabsTrigger>
          <TabsTrigger value="progress">営業進捗</TabsTrigger>
          <TabsTrigger value="ai">AI 分析</TabsTrigger>
        </TabsList>

        {/* wide (md 以上): 個別ボタン */}
        <div className="hidden md:flex items-center gap-2 ml-auto">
          <Link
            href={editHref}
            className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md text-sm border border-border bg-card hover:bg-muted/40 text-foreground whitespace-nowrap"
            title="フル編集 + AI 再実行ページ"
          >
            <Edit2 className="h-4 w-4" /> 編集
          </Link>
          <DeleteStoreButton storeId={store.id} storeName={store.name} />
        </div>

        {/* narrow (md 未満): [...] にまとめる */}
        <div className="md:hidden ml-auto">
          <MoreActionsMenu>
            <Link
              href={editHref}
              className="inline-flex items-center gap-2 h-9 px-3 rounded-md text-sm hover:bg-muted/40 text-foreground whitespace-nowrap"
              title="フル編集 + AI 再実行ページ"
            >
              <Edit2 className="h-4 w-4" /> 編集
            </Link>
            <DeleteStoreButton storeId={store.id} storeName={store.name} />
          </MoreActionsMenu>
        </div>
      </div>

      <TabsPanel value="basic" className="space-y-4">
        <BasicInfoCard store={store} profiles={profiles} />
        <BasicInfoFieldsCard storeId={store.id} basicInfo={store.basic_info} />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <MapEmbedCard store={store} />
          <WebAssetCard store={store} />
        </div>
      </TabsPanel>

      <TabsPanel value="progress">
        <SalesProgressCard store={store} deals={deals} profiles={profiles} />
      </TabsPanel>

      <TabsPanel value="ai" className="space-y-4">
        <AiAnalysisDetailSection
          store={store}
          isApiKeyConfigured={isApiKeyConfigured}
        />
      </TabsPanel>
    </Tabs>
  );
}

/* ------------------------------------------------------------------ */
/*  Overflow menu (依存ゼロの軽量実装、stores-filter-bar.tsx と同パターン) */
/* ------------------------------------------------------------------ */

function MoreActionsMenu({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent) => {
      const root = rootRef.current;
      if (!root) return;
      if (e.target instanceof Node && root.contains(e.target)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", onPointer);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onPointer);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      {/*
        正方形のアイコンボタンは `size="icon"` (h-9 w-9) を使う。`size="sm"` に
        `h-9 w-9 p-0` を重ねる書き方は成立しない。`cn` は素の clsx で
        tailwind-merge を持たないため `p-0` と `sm` の `px-3` が両方出力され、
        生成 CSS では `.px-3` が後に来て勝つ。左右 padding が 12px 残り、
        16px のアイコンが 10px 幅に潰れる (docs/architecture/responsive.md §4.3)。
      */}
      <Button
        variant="outline"
        size="icon"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="その他のアクション"
      >
        <MoreHorizontal className="h-4 w-4" />
      </Button>
      {open && (
        <div
          role="menu"
          className={cn(
            "absolute right-0 top-full z-40 mt-1 w-max",
            "rounded-md border border-border bg-popover text-popover-foreground shadow-popover",
            "p-1 flex flex-col gap-1",
          )}
        >
          {children}
        </div>
      )}
    </div>
  );
}
