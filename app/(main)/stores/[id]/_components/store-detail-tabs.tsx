"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { Edit2, MoreHorizontal } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsPanel } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils/cn";
import { BasicInfoCard } from "./basic-info-card";
import { MapEmbedCard } from "./map-embed-card";
import { WebAssetCard } from "./web-asset-card";
import { MemoCard } from "./memo-card";
import { AiAnalysisDetailSection } from "./ai-analysis-detail-section";
import { StageInlineSelect } from "./stage-inline-select";
import { DeleteStoreButton } from "./delete-store-button";
import type { Store } from "@/types/store";
import type { Profile } from "@/types/profile";

interface StoreDetailTabsProps {
  store: Store;
  profiles: readonly Profile[];
  isApiKeyConfigured: boolean;
  assignedSalesName: string;
  dealCount: number;
  /**
   * AI 分析タブ末尾に差し込む Deep Research セクション (RSC スロット)。
   * 親 RSC (`page.tsx`) で `<Suspense><DeepResearchSection storeId={...}/></Suspense>`
   * を生成して渡す。client component である本タブから async server component を
   * 直接 import できないため、ReactNode prop として注入する。
   * deep-research-pipeline spec #43 で追加。
   */
  deepResearchSlot?: ReactNode;
}

export function StoreDetailTabs({
  store,
  profiles,
  isApiKeyConfigured,
  assignedSalesName,
  dealCount,
  deepResearchSlot,
}: StoreDetailTabsProps) {
  const editHref = `/stores/${store.id}/edit`;

  return (
    <Tabs defaultValue="basic">
      <div className="flex items-center gap-2">
        <StageInlineSelect storeId={store.id} current={store.stage} />
        <TabsList>
          <TabsTrigger value="basic">基本情報</TabsTrigger>
          <TabsTrigger value="supplement">補足情報</TabsTrigger>
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
          <DeleteStoreButton
            storeId={store.id}
            storeName={store.name}
            dealCount={dealCount}
          />
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
            <DeleteStoreButton
              storeId={store.id}
              storeName={store.name}
              dealCount={dealCount}
            />
          </MoreActionsMenu>
        </div>
      </div>

      <TabsPanel value="basic" className="space-y-4">
        <BasicInfoCard store={store} profiles={profiles} />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <MapEmbedCard store={store} />
          <WebAssetCard store={store} />
        </div>
      </TabsPanel>

      <TabsPanel value="supplement">
        <MemoCard store={store} />
      </TabsPanel>

      <TabsPanel value="ai" className="space-y-4">
        <AiAnalysisDetailSection
          store={store}
          isApiKeyConfigured={isApiKeyConfigured}
          assignedSalesName={assignedSalesName}
        />
        {deepResearchSlot}
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
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="その他のアクション"
        className="h-9 w-9 p-0"
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
