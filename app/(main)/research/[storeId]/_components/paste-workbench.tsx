"use client";

/**
 * 調査結果貼付ワークベンチ (store-basic-info / task 3.6, PR2 単線化)
 *
 * 旧 STEP1 (構造化保存) / STEP2 (51 項目プレビュー) を撤去し、「貼付 → 生成 → 編集 → 保存」
 * の単線フローに簡素化 (#121)。生成は `generateSalesAssetsAction` を呼び、basic_info +
 * 貼付テキスト経路で AiAnalysisResult を作って保存する。Stage 2 構造化 (`structurer`) を
 * 一切経由しない (R7.3)。
 *
 * 旧 `structureFromPastedMarkdownAction` / `generateCallScriptFromMarkdownAction` /
 * `DeepResearchReportView` の利用は本コンポーネントから外したが、関数 / コンポーネント
 * 自体の物理削除は task 4.2 (PR3) で実施する (#110 連動)。
 *
 * 関連: design.md §UI / paste-workbench, §Migration Strategy PR2, requirements.md §4.1 §4.2 §7.3 §7.4 §7.5
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Copy, Sparkles, Save } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { generateSalesAssetsAction } from "@/lib/actions/sales-assets-actions";
import { updateStorePatchAction } from "@/lib/actions/store-actions";
import { ResearchPromptStep } from "./research-prompt-step";
import type { Store } from "@/types/store";
import type { AiAnalysisResult } from "@/lib/ai/schema";

type ScriptFieldKey = keyof Omit<AiAnalysisResult, "confidence">;
const SCRIPT_FIELDS: ReadonlyArray<{
  key: ScriptFieldKey;
  label: string;
  rows: number;
}> = [
  { key: "strengths_markdown", label: "強み (Markdown)", rows: 6 },
  { key: "weaknesses_markdown", label: "弱み (Markdown)", rows: 6 },
  { key: "gourmet_paid_status", label: "グルメサイト課金状況", rows: 3 },
  { key: "gbp_completeness", label: "GBP 充実度", rows: 4 },
  { key: "call_script", label: "架電スクリプト", rows: 10 },
];

interface PasteWorkbenchProps {
  store: Store;
  /** STEP0: 外部 Gem へ渡す調査プロンプト (server で buildBasicInfoBlock 算出済)。 */
  researchPrompt: string;
  /** STEP0「Gem を開く」が開く URL。未設定なら null。 */
  gemUrl: string | null;
}

export function PasteWorkbench({
  store,
  researchPrompt,
  gemUrl,
}: PasteWorkbenchProps) {
  const router = useRouter();
  const [markdown, setMarkdown] = useState<string>("");
  const [aiResult, setAiResult] = useState<AiAnalysisResult | null>(
    store.ai_analysis_result,
  );
  const [persisted, setPersisted] = useState<boolean>(true);
  const [generating, startGenerating] = useTransition();
  const [saving, startSaving] = useTransition();

  const busy = generating || saving;

  const onGenerate = () => {
    startGenerating(async () => {
      const res = await generateSalesAssetsAction(store.id, markdown);
      if (res.ok) {
        setAiResult(res.data);
        setPersisted(true); // generateSalesAssetsAction 内で ai_analysis_result 保存済
        toast.success(res.message ?? "営業資産を生成しました");

        // 既に「架電済み」の店舗は降格させない。それ以外は調査完了として stage 更新。
        const nextStage =
          store.stage === "架電済み" ? "架電済み" : "DeepResearch済み";
        if (store.stage !== nextStage) {
          const stageRes = await updateStorePatchAction(store.id, {
            stage: nextStage,
          });
          if (!stageRes.ok) {
            // stage 更新失敗は警告のみで生成成功は保持
            toast.error(`stage 更新失敗: ${stageRes.error}`);
          }
        }
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  };

  const onFieldChange = (key: ScriptFieldKey, value: string) => {
    setAiResult((prev) => (prev ? { ...prev, [key]: value } : prev));
    setPersisted(false);
  };

  const onCopy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("コピーしました");
    } catch {
      toast.error("コピーに失敗しました");
    }
  };

  const onSave = () => {
    if (!aiResult) return;
    startSaving(async () => {
      const res = await updateStorePatchAction(store.id, {
        ai_analysis_result: aiResult,
      });
      if (res.ok) {
        toast.success("店舗に保存しました");
        setPersisted(true);
        router.push(`/stores/${store.id}`);
      } else {
        toast.error(res.error);
      }
    });
  };

  return (
    <div className="space-y-4 max-w-4xl mx-auto">
      <div>
        <Link
          href="/research"
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          ← 調査
        </Link>
        <h2 className="text-xl md:text-2xl font-bold text-foreground mt-1">
          {store.name}
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          調査結果テキストを貼り付けて、店舗の基本情報と合わせて強み・弱み・架電スクリプトを生成します。
          貼付欄が空でも基本情報のみで生成可能です。
        </p>
      </div>

      <ResearchPromptStep researchPrompt={researchPrompt} gemUrl={gemUrl} />

      <Card>
        <Card.Header>
          <Card.Title>調査結果から営業資産を生成</Card.Title>
        </Card.Header>
        <Card.Body className="space-y-4">
          <div className="space-y-1.5">
            <label
              htmlFor="paste-markdown"
              className="text-sm font-medium text-foreground"
            >
              調査結果テキスト (任意・構造化されません)
            </label>
            <Textarea
              id="paste-markdown"
              value={markdown}
              onChange={(e) => setMarkdown(e.target.value)}
              rows={12}
              placeholder="Gemini UI で実施した DeepResearch の結果テキスト等をここに貼り付けてください"
              aria-label="調査結果テキスト"
              disabled={busy}
            />
          </div>

          <div className="flex justify-end">
            <Button
              type="button"
              variant="primary"
              onClick={onGenerate}
              disabled={busy}
            >
              <Sparkles className="h-3.5 w-3.5" />
              {generating
                ? "生成中…"
                : aiResult
                  ? "強み・弱み・架電を再生成"
                  : "強み・弱み・架電を生成"}
            </Button>
          </div>

          {aiResult ? (
            <div className="space-y-4 border-t border-border pt-4">
              {SCRIPT_FIELDS.map((f) => (
                <div key={f.key} className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label
                      htmlFor={`ai-${f.key}`}
                      className="text-sm font-medium text-foreground"
                    >
                      {f.label}
                    </label>
                    <button
                      type="button"
                      onClick={() => onCopy(aiResult[f.key])}
                      className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                    >
                      <Copy className="h-3 w-3" />
                      コピー
                    </button>
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
                {!persisted && (
                  <span className="text-xs text-warning">
                    未保存の変更があります
                  </span>
                )}
                <Button
                  type="button"
                  variant="primary"
                  onClick={onSave}
                  disabled={busy || persisted}
                >
                  <Save className="h-3.5 w-3.5" />
                  {saving ? "保存中…" : "保存して店舗へ"}
                </Button>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              生成すると、編集可能な強み・弱み・架電スクリプトがここに表示されます。
            </p>
          )}
        </Card.Body>
      </Card>
    </div>
  );
}
