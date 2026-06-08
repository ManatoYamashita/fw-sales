"use client";

/**
 * 営業資産生成 UI (store-basic-info / task 3.5, PR2)
 *
 * 店舗詳細「AI 分析」タブから呼ばれる単一の生成入口 (R7.4)。
 * 表示要素:
 * - basic_info の充足率サマリ (店舗名のみでも生成可能 = R7.2 の可視化)
 * - 貼付調査テキスト textarea (空可、構造化しない: R4.2)
 * - 「営業資産を生成」ボタン → `generateSalesAssetsAction` 呼出
 * - 生成結果の各フィールド (強み/弱み/グルメ課金/GBP/架電) を編集可能 + 保存
 *
 * 既存 `AiAnalysisPanel` (formValues 経路) は本タスクで本コンポーネントに置換される
 * (店舗詳細のみ。`/stores/new` の AiAnalysisPanel は task 3.6 で撤去)。
 *
 * 関連: design.md §UI / 営業資産生成フロー, requirements.md §1.1 §4.1 §4.3 §7.1 §7.2 §7.4 §7.5
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Save, Sparkles } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { generateSalesAssetsAction } from "@/lib/actions/sales-assets-actions";
import { updateStorePatchAction } from "@/lib/actions/store-actions";
import { BASIC_INFO_ITEMS } from "@/lib/domain/basic-info-items";
import type { BasicInfo, BasicInfoField } from "@/types/basic-info";
import type {
  AiAnalysisResult,
  ConfidenceFieldKey,
} from "@/types/ai-analysis";

const FIELD_LABEL: Record<keyof Omit<AiAnalysisResult, "confidence">, string> =
  {
    strengths_markdown: "強み",
    weaknesses_markdown: "弱み",
    gourmet_paid_status: "グルメサイト課金状況",
    gbp_completeness: "GBP 充実度",
    call_script: "架電スクリプト",
  };

const CONFIDENCE_LABEL: Record<ConfidenceFieldKey, string> = {
  strengths: "強み",
  weaknesses: "弱み",
  gourmet_paid_status: "グルメ課金",
  gbp_completeness: "GBP",
  call_script: "架電",
};

function isFilled(field: BasicInfoField | undefined): boolean {
  if (!field) return false;
  if (field.value === null) return false;
  if (field.value.trim() === "") return false;
  return true;
}

export interface SalesAssetsGeneratorProps {
  storeId: string;
  storeName: string;
  basicInfo: BasicInfo;
  initialResult: AiAnalysisResult | null;
  isApiKeyConfigured: boolean;
}

export function SalesAssetsGenerator({
  storeId,
  storeName,
  basicInfo,
  initialResult,
  isApiKeyConfigured,
}: SalesAssetsGeneratorProps) {
  const router = useRouter();
  const [pasted, setPasted] = useState<string>("");
  const [instructions, setInstructions] = useState<string>("");
  const [aiResult, setAiResult] = useState<AiAnalysisResult | null>(
    initialResult,
  );
  const [persisted, setPersisted] = useState<boolean>(true);
  const [generating, startGenerating] = useTransition();
  const [saving, startSaving] = useTransition();

  // basic_info 充足率
  const totalItems = BASIC_INFO_ITEMS.length;
  const filledCount = BASIC_INFO_ITEMS.reduce(
    (n, item) => (isFilled(basicInfo[item.key]) ? n + 1 : n),
    0,
  );
  const busy = generating || saving;

  const onGenerate = () => {
    startGenerating(async () => {
      const res = await generateSalesAssetsAction(storeId, pasted, instructions);
      if (res.ok) {
        setAiResult(res.data);
        setPersisted(true); // generate 内部で save 済み
        toast.success(res.message ?? "営業資産を生成しました");
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  };

  const onFieldChange = (
    key: keyof Omit<AiAnalysisResult, "confidence">,
    value: string,
  ) => {
    setAiResult((prev) => {
      if (!prev) return prev;
      return { ...prev, [key]: value };
    });
    setPersisted(false);
  };

  const onSave = () => {
    if (!aiResult) return;
    startSaving(async () => {
      const res = await updateStorePatchAction(storeId, {
        ai_analysis_result: aiResult,
      });
      if (res.ok) {
        toast.success(res.message ?? "編集を保存しました");
        setPersisted(true);
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  };

  return (
    <Card>
      <Card.Header>
        <Card.Title>営業資産を生成</Card.Title>
        <span
          className="text-xs text-muted-foreground tabular-nums"
          aria-label={`基本情報の充足 ${filledCount} / ${totalItems}`}
        >
          基本情報 {filledCount} / {totalItems} 充足
        </span>
      </Card.Header>
      <Card.Body className="space-y-4">
        <p className="text-xs text-muted-foreground">
          店舗の基本情報 (充足項目のみ) と任意の調査結果テキストから、強み・弱み・架電スクリプト等を生成します。
          店舗名のみでも実行可能ですが、基本情報が充足しているほど出力品質が上がります。
        </p>

        {/* 貼付調査テキスト */}
        <div className="space-y-1.5">
          <label
            htmlFor="sales-assets-pasted"
            className="text-sm font-medium text-foreground"
          >
            調査結果テキスト (任意・構造化されません)
          </label>
          <Textarea
            id="sales-assets-pasted"
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
            rows={6}
            placeholder="Gemini UI で実施した DeepResearch の結果テキスト等を貼り付けてください (空欄でも生成可能)"
            disabled={busy}
            aria-label="調査結果テキスト"
          />
        </div>

        {/* 追加指示 */}
        <div className="space-y-1.5">
          <label
            htmlFor="sales-assets-instructions"
            className="text-sm font-medium text-foreground"
          >
            追加指示 (任意・最大 500 字)
          </label>
          <Textarea
            id="sales-assets-instructions"
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            rows={2}
            placeholder="例: 平日昼にかけやすい時間帯を提案して"
            disabled={busy}
            aria-label="追加指示"
            maxLength={500}
          />
        </div>

        {/* 生成ボタン */}
        <div className="flex items-center justify-end gap-2">
          {!isApiKeyConfigured && (
            <span className="text-xs text-warning">
              GEMINI_API_KEY が未設定のため生成できません
            </span>
          )}
          <Button
            type="button"
            variant="primary"
            onClick={onGenerate}
            disabled={busy || !isApiKeyConfigured || !storeName.trim()}
          >
            <Sparkles className="h-3.5 w-3.5" />
            {generating
              ? "生成中…"
              : aiResult
                ? "営業資産を再生成"
                : "営業資産を生成"}
          </Button>
        </div>

        {/* 生成結果(編集可能) */}
        {aiResult && (
          <div className="space-y-4 border-t border-border pt-4">
            {(Object.keys(FIELD_LABEL) as (keyof typeof FIELD_LABEL)[]).map(
              (key) => {
                const conf = aiResult.confidence[
                  key === "strengths_markdown"
                    ? "strengths"
                    : key === "weaknesses_markdown"
                      ? "weaknesses"
                      : key
                ] as number | undefined;
                return (
                  <div key={key} className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <label
                        htmlFor={`sales-assets-${key}`}
                        className="text-sm font-medium text-foreground"
                      >
                        {FIELD_LABEL[key]}
                        {typeof conf === "number" && (
                          <span className="ml-2 text-xs text-muted-foreground">
                            (確信度 {conf})
                          </span>
                        )}
                      </label>
                    </div>
                    <Textarea
                      id={`sales-assets-${key}`}
                      value={aiResult[key]}
                      onChange={(e) => onFieldChange(key, e.target.value)}
                      rows={key === "call_script" ? 10 : 5}
                      disabled={busy}
                    />
                  </div>
                );
              },
            )}
            <div className="flex items-center justify-end gap-2">
              {!persisted && (
                <span className="text-xs text-warning">
                  未保存の変更があります
                </span>
              )}
              <Button
                type="button"
                variant="primary"
                size="sm"
                onClick={onSave}
                disabled={busy || persisted}
              >
                <Save className="h-3.5 w-3.5" />
                {saving ? "保存中…" : "編集を保存"}
              </Button>
            </div>
          </div>
        )}
      </Card.Body>
    </Card>
  );
}

// CONFIDENCE_LABEL は将来 confidence 個別表示で使う余地のため export しておく
export { CONFIDENCE_LABEL };
