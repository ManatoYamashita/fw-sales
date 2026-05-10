"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import {
  AiAnalysisPanel,
  type AiAnalysisFormSnapshot,
} from "@/app/(main)/stores/new/_components/ai-analysis-panel";
import { updateStorePatchAction } from "@/lib/actions/store-actions";
import type { Store } from "@/types/store";
import type {
  AiAnalysisResult,
  AiAnalysisConfidence,
  ConfidenceFieldKey,
} from "@/types/ai-analysis";

export interface AiAnalysisDetailSectionProps {
  store: Store;
  isApiKeyConfigured: boolean;
}

export function AiAnalysisDetailSection({
  store,
  isApiKeyConfigured,
}: AiAnalysisDetailSectionProps) {
  const router = useRouter();
  const [aiResult, setAiResult] = useState<AiAnalysisResult | null>(
    store.ai_analysis_result,
  );
  const [aiConfidence, setAiConfidence] = useState<
    Partial<AiAnalysisConfidence>
  >(() => store.ai_analysis_result?.confidence ?? {});
  const [aiPersisted, setAiPersisted] = useState<boolean>(true);
  const [pending, startTransition] = useTransition();

  const getFormSnapshot = (): AiAnalysisFormSnapshot => ({
    name: store.name,
    prefecture: store.prefecture,
    city: store.city,
    address: store.address,
    genre: store.genre,
    phone: store.phone,
    site_url: store.site_url,
    instagram_url: store.instagram_url,
    map_url: store.map_url,
    review_avg: String(store.review_avg ?? ""),
    review_count: String(store.review_count ?? ""),
    memo: store.memo,
    operator_type: store.operator_type,
    operator_name: store.operator_name,
    htmlContent: null,
    assignedSales: store.assigned_sales,
  });

  const onAiResult = (result: AiAnalysisResult) => {
    setAiResult(result);
    setAiConfidence(result.confidence);
    setAiPersisted(false);
  };

  const onAiFieldEdit = (field: ConfidenceFieldKey) => {
    setAiPersisted(false);
    setAiConfidence((prev) => {
      if (!(field in prev)) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });
  };

  const onAiResultFieldChange = (
    field: keyof Omit<AiAnalysisResult, "confidence">,
    value: string,
  ) => {
    setAiResult((prev) => {
      if (!prev) return prev;
      return { ...prev, [field]: value };
    });
  };

  const onSave = () => {
    startTransition(async () => {
      const result = await updateStorePatchAction(store.id, {
        ai_analysis_result: aiResult,
      });
      if (result.ok) {
        toast.success(result.message ?? "AI 分析を保存しました");
        setAiPersisted(true);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  };

  return (
    <div className="space-y-3">
      <AiAnalysisPanel
        getFormSnapshot={getFormSnapshot}
        initialResult={store.ai_analysis_result}
        onResult={onAiResult}
        onFieldEdit={onAiFieldEdit}
        isApiKeyConfigured={isApiKeyConfigured}
        currentResult={aiResult}
        confidence={aiConfidence}
        onResultFieldChange={onAiResultFieldChange}
        storeId={store.id}
      />
      {aiResult !== null && (
        <div className="flex items-center justify-end gap-2">
          {!aiPersisted && (
            <span className="text-xs text-warning">未保存の変更があります</span>
          )}
          <Button
            type="button"
            variant="primary"
            size="sm"
            onClick={onSave}
            disabled={pending || aiPersisted}
          >
            <Save className="h-3.5 w-3.5" />
            {pending ? "保存中…" : "AI 分析を保存"}
          </Button>
        </div>
      )}
    </div>
  );
}
