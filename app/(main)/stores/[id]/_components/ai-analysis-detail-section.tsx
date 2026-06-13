"use client";

/**
 * 店舗詳細「AI 分析」タブの生成セクション (store-basic-info / task 3.5 + task 4.2 PR3a)
 *
 * `SalesAssetsGenerator` (basic_info + 貼付テキスト経路) を呼ぶ薄いラッパ。
 * R7.4「店舗詳細上の単一の操作に集約」のため、旧 AiAnalysisPanel / analyzeStoreAction 経路は
 * task 3.5 で本セクションから撤去、task 4.2 (PR3a) で関連 props (promptTemplates /
 * hasDeepResearchReport / assignedSalesName) も完全撤去。
 *
 * 関連: design.md §UI / ai-analysis-detail-section.tsx, requirements.md §7.4
 */

import { SalesAssetsGenerator } from "./sales-assets-generator";
import type { Store } from "@/types/store";

export interface AiAnalysisDetailSectionProps {
  store: Store;
  isApiKeyConfigured: boolean;
}

export function AiAnalysisDetailSection({
  store,
  isApiKeyConfigured,
}: AiAnalysisDetailSectionProps) {
  return (
    <SalesAssetsGenerator
      storeId={store.id}
      storeName={store.name}
      basicInfo={store.basic_info}
      initialResult={store.ai_analysis_result}
      isApiKeyConfigured={isApiKeyConfigured}
    />
  );
}
