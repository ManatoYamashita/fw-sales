"use client";

/**
 * 営業資産生成セクション。**営業資産を生成する唯一の入口** (Issue #300)。
 *
 * #300 以前は店舗詳細「AI 分析」タブにも生成 UI (Gemini 手動貼付の欄つき) があり、
 * 入口が 3 か所に分かれていた。店舗詳細は閲覧専用に変え、生成・編集はここに集約した
 * (`sales-assets-single-entry.test.ts` が呼び出し元 1 件を固定する)。
 *
 * - 補足情報: 電話で聞いた話や Gemini 等で別途調べた結果を貼る欄。旧「Gemini 手動貼付」
 *   経路はここへ吸収した。`generateSalesAssetsAction` の第 2 引数 (調査結果テキスト =
 *   一次情報) として渡す。#300 以前の「追加調査メモ」は第 3 引数 (追加指示) に渡っており、
 *   一次情報として扱われていなかった。
 * - 生成への追加指示: 出力への注文。第 3 引数。
 *
 * 生成が読むのは `store.basic_info` だけで、AI 調査の結果はレビューで採用するまで
 * 使われない。その事実を `getSalesAssetGenerationContext` の文脈に応じて表示する。
 *
 * `store.stage` の遷移は行わない。レビュー完了時の遷移 (`completeReviewAction`) が
 * 本フローの唯一の stage 変更経路 (Plan §15)。
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Save, Sparkles } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { CopyButton } from "@/components/feature/copy-button";
import { runAction } from "@/lib/client/run-action";
import { generateSalesAssetsAction } from "@/lib/actions/sales-assets-actions";
import { updateStorePatchAction } from "@/lib/actions/store-actions";
import { BASIC_INFO_ITEMS } from "@/lib/domain/basic-info-items";
import { isBasicInfoFieldFilled } from "@/lib/domain/store-research-phase";
import {
  salesAssetGenerateLabel,
  type SalesAssetGenerationContext,
} from "@/lib/domain/research-flow";
import {
  MAX_INSTRUCTIONS_LENGTH,
  MAX_SUPPLEMENT_LENGTH,
} from "@/lib/domain/sales-assets-input";
import { SALES_ASSET_FIELDS } from "@/lib/domain/sales-asset-fields";
import type { Store } from "@/types/store";
import type { AiAnalysisResult } from "@/lib/ai/schema";

/** 深いリンク (`salesAssetsHref`) の着地点。 */
export const SALES_ASSETS_SECTION_ID = "sales-assets";

/** 警告ボックスを出さない文脈で添える一文。 */
function contextNote(context: SalesAssetGenerationContext): string | null {
  switch (context.kind) {
    case "reviewed":
      return null;
    case "unreviewed":
      // 未対応 0 件 = 全件判断済み。採用分は判断の時点で基本情報へ反映済み。
      return "レビューで採用した項目は基本情報に反映済みです。レビューを完了すると手順 ② が完了します。";
    case "running":
      return "AI調査の完了後にレビューすると、調査結果を生成に使えます。";
    case "failedAfterReview":
      return "直近のAI調査は失敗しました。前回のレビューで採用した項目は基本情報に入っており、生成に使われます。";
    case "none":
      return "先にAI調査とレビューを行うと、調査結果を生成に使えます。";
  }
}

export function SalesAssetSection({
  store,
  context,
  isApiKeyConfigured,
  onJumpToReview,
}: {
  store: Store;
  context: SalesAssetGenerationContext;
  isApiKeyConfigured: boolean;
  /** 未レビュー時に ② レビューへ戻る。 */
  onJumpToReview: () => void;
}) {
  const router = useRouter();
  const [supplement, setSupplement] = useState("");
  const [instructions, setInstructions] = useState("");
  const [aiResult, setAiResult] = useState<AiAnalysisResult | null>(store.ai_analysis_result);
  const [persisted, setPersisted] = useState(true);
  const [generating, startGenerating] = useTransition();
  const [saving, startSaving] = useTransition();
  const busy = generating || saving;

  const totalItems = BASIC_INFO_ITEMS.length;
  const filledCount = BASIC_INFO_ITEMS.reduce(
    (n, item) => (isBasicInfoFieldFilled(store.basic_info[item.key]) ? n + 1 : n),
    0,
  );
  const reviewed = context.kind === "reviewed";

  const onGenerate = () => {
    startGenerating(async () => {
      const res = await runAction(
        () => generateSalesAssetsAction(store.id, supplement, instructions),
        { success: "営業資産を生成しました" },
      );
      if (res?.ok) {
        setAiResult(res.data);
        setPersisted(true);
        router.refresh();
      }
    });
  };

  const onFieldChange = (key: keyof Omit<AiAnalysisResult, "confidence">, value: string) => {
    setAiResult((prev) => (prev ? { ...prev, [key]: value } : prev));
    setPersisted(false);
  };

  const onSave = () => {
    if (!aiResult) return;
    startSaving(async () => {
      const res = await runAction(
        () => updateStorePatchAction(store.id, { ai_analysis_result: aiResult }),
        // 共通の「更新しました」ではなく、生成結果を店舗へ保存したことを伝える。
        { success: () => "店舗に保存しました" },
      );
      if (res?.ok) {
        setPersisted(true);
        router.refresh();
      }
    });
  };

  return (
    <Card
      id={SALES_ASSETS_SECTION_ID}
      className={reviewed ? "scroll-mt-24 border-primary/40" : "scroll-mt-24"}
    >
      <Card.Header>
        <Card.Title>③ 営業資産を生成</Card.Title>
        <span className="text-xs text-muted-foreground tabular-nums">
          基本情報 {filledCount} / {totalItems} 件を使用
        </span>
      </Card.Header>
      <Card.Body className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">
          店舗の基本情報 (入力済みの項目) と補足情報から、強み・弱み・架電スクリプトなどを生成します。
        </p>

        {context.kind === "unreviewed" && context.undecidedCount > 0 ? (
          <div
            role="note"
            className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2"
          >
            <p className="flex items-start gap-1.5 text-sm text-foreground">
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-warning" aria-hidden />
              <span>
                AI調査結果のうち未対応の {context.undecidedCount} 件は、レビューで採用するまで生成に使われません。
              </span>
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="ml-auto"
              onClick={onJumpToReview}
            >
              ② レビューへ戻る
            </Button>
          </div>
        ) : contextNote(context) ? (
          <p className="text-sm text-muted-foreground">{contextNote(context)}</p>
        ) : null}

        <div className="flex flex-col gap-1.5">
          <label htmlFor="sales-assets-supplement" className="text-sm font-medium text-foreground">
            補足情報(任意)
          </label>
          <p id="sales-assets-supplement-hint" className="text-xs text-muted-foreground">
            電話で聞いた話や、Gemini などで別途調べた結果を貼り付けられます。一次情報として重視されます。
          </p>
          <Textarea
            id="sales-assets-supplement"
            value={supplement}
            onChange={(e) => setSupplement(e.target.value)}
            maxLength={MAX_SUPPLEMENT_LENGTH}
            rows={4}
            aria-describedby="sales-assets-supplement-hint"
            disabled={busy}
          />
        </div>

        <details className="group">
          <summary className="cursor-pointer select-none text-sm font-medium text-foreground">
            生成への追加指示(任意)
          </summary>
          <div className="mt-2 flex flex-col gap-1.5">
            <Textarea
              id="sales-assets-instructions"
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              maxLength={MAX_INSTRUCTIONS_LENGTH}
              rows={2}
              placeholder="例: 平日昼にかけやすい時間帯を提案して"
              aria-label="生成への追加指示"
              disabled={busy}
            />
            <p className="text-xs text-muted-foreground text-right tabular-nums">
              {instructions.length}/{MAX_INSTRUCTIONS_LENGTH}
            </p>
          </div>
        </details>

        <div className="flex flex-wrap items-center justify-end gap-2">
          {!isApiKeyConfigured && (
            <span className="text-xs text-warning">
              GEMINI_API_KEY が未設定のため生成できません。管理者に設定を依頼してください。
            </span>
          )}
          <Button
            type="button"
            variant={reviewed ? "primary" : "secondary"}
            onClick={onGenerate}
            pending={generating}
            disabled={busy || !isApiKeyConfigured}
          >
            <Sparkles className="h-3.5 w-3.5" aria-hidden />
            {generating ? "生成中…" : salesAssetGenerateLabel(context, aiResult !== null)}
          </Button>
        </div>

        {aiResult ? (
          <div className="flex flex-col gap-4 border-t border-border pt-4">
            {SALES_ASSET_FIELDS.map((f) => (
              <div key={f.key} className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between gap-2">
                  <label htmlFor={`ai-${f.key}`} className="text-sm font-medium text-foreground">
                    {f.label}
                  </label>
                  <CopyButton text={aiResult[f.key]} target={f.label} />
                </div>
                <Textarea
                  id={`ai-${f.key}`}
                  value={aiResult[f.key]}
                  onChange={(e) => onFieldChange(f.key, e.target.value)}
                  rows={f.rows}
                  disabled={busy}
                />
              </div>
            ))}
            <div className="flex items-center justify-end gap-2">
              {!persisted && <span className="text-xs text-warning">未保存の変更があります</span>}
              <Button type="button" variant="primary" onClick={onSave} pending={saving} disabled={busy || persisted}>
                <Save className="h-3.5 w-3.5" aria-hidden />
                {saving ? "保存中…" : "保存"}
              </Button>
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            生成すると、編集できる強み・弱み・架電スクリプトがここに表示されます。
          </p>
        )}
      </Card.Body>
    </Card>
  );
}
