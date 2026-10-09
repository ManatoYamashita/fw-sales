/**
 * 営業資産 (`AiAnalysisResult`) の表示項目。
 *
 * 生成・編集する `/research/[storeId]` と、閲覧する店舗詳細「AI 分析」タブで同じ並びと
 * 名前を使う (#300 以前は 2 画面で「強み (Markdown)」「強み」と名前が揃っていなかった)。
 */

import type { AiAnalysisResult } from "@/types/ai-analysis";

export type SalesAssetFieldKey = keyof Omit<AiAnalysisResult, "confidence">;

export const SALES_ASSET_FIELDS: ReadonlyArray<{
  key: SalesAssetFieldKey;
  label: string;
  /** 編集時の textarea の行数。 */
  rows: number;
}> = [
  { key: "call_script", label: "架電スクリプト", rows: 10 },
  { key: "strengths_markdown", label: "強み", rows: 6 },
  { key: "weaknesses_markdown", label: "弱み", rows: 6 },
  { key: "gourmet_paid_status", label: "グルメサイト課金状況", rows: 3 },
  { key: "gbp_completeness", label: "GBP 充実度", rows: 4 },
];
