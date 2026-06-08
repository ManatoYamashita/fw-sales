"use client";

/**
 * 店舗詳細「AI 分析」タブの生成セクション (store-basic-info / task 3.5, PR2)
 *
 * 旧 `AiAnalysisPanel` (formValues 経路) を `SalesAssetsGenerator` (basic_info + 貼付
 * テキスト経路) に置換した薄いラッパ。R7.4「店舗詳細上の単一の操作に集約」のため、
 * 旧経路 (analyzeStoreAction) は本セクションからは呼ばない (`/stores/new` 側で
 * temporary に残置、task 3.6 で完全撤去)。
 *
 * promptTemplates / hasDeepResearchReport / assignedSalesName は旧 AiAnalysisPanel 用
 * props だったが、新経路では generateSalesAssetsAction 内で必要な情報を解決するため
 * 不要。互換性のため受け取りは維持し、本コンポーネントでは使用しない。
 *
 * 関連: design.md §UI / ai-analysis-detail-section.tsx, requirements.md §7.4
 */

import { SalesAssetsGenerator } from "./sales-assets-generator";
import type { PromptTemplateOption } from "@/app/(main)/stores/new/_components/ai-analysis-panel";
import type { Store } from "@/types/store";

export interface AiAnalysisDetailSectionProps {
  store: Store;
  isApiKeyConfigured: boolean;
  /**
   * 営業担当の表示名 (旧 AiAnalysisPanel 用)。新 SalesAssetsGenerator は
   * generateSalesAssetsAction 内で profile を解決するため不要だが、parent RSC からの
   * props 互換性のため受け取りだけ維持。
   */
  assignedSalesName?: string;
  /** SSR で取得したプロンプトテンプレート一覧 (旧 AiAnalysisPanel 用、新経路では未使用)。 */
  promptTemplates: readonly PromptTemplateOption[];
  /** 当該店舗に Deep Research レポートが存在するか (旧 UI 用、新経路では未使用)。 */
  hasDeepResearchReport?: boolean;
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
