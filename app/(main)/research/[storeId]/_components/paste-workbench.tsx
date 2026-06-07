"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Copy } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { DeepResearchReportView } from "@/app/(main)/stores/[id]/_components/deep-research-report-view";
import {
  structureFromPastedMarkdownAction,
  generateCallScriptFromMarkdownAction,
} from "@/lib/actions/research-paste-actions";
import { updateStorePatchAction } from "@/lib/actions/store-actions";
import type { Store } from "@/types/store";
import type { DeepResearchReport } from "@/types/deep-research";
import type { AiAnalysisResult } from "@/lib/ai/schema";

interface PasteWorkbenchProps {
  store: Store;
  /** 既存の最新レポート(再訪時のプレビューと貼付欄の初期値に使う)。 */
  initialReport: DeepResearchReport | null;
}

/** STEP 3 で編集する 5 つのテキストフィールド(confidence は別管理)。 */
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

/**
 * 貼付ワークベンチ。Gemini の DeepResearch 結果 Markdown を貼り付け、
 * STEP 1(構造化)・STEP 2(51 項目プレビュー)・STEP 3(架電生成)を行う。
 * 構造化と架電生成は独立しており、構造化に失敗しても架電生成は実行できる。
 */
export function PasteWorkbench({ store, initialReport }: PasteWorkbenchProps) {
  const router = useRouter();
  // 再訪時は保存済み原文を初期値に。構造化後も入力は保持され、そのまま架電生成に使える。
  const [markdown, setMarkdown] = useState(initialReport?.full_markdown ?? "");
  const [aiResult, setAiResult] = useState<AiAnalysisResult | null>(
    store.ai_analysis_result,
  );
  const [structuring, startStructuring] = useTransition();
  const [generating, startGenerating] = useTransition();
  const [saving, startSaving] = useTransition();

  const trimmed = markdown.trim();
  const busy = structuring || generating || saving;

  const onStructure = () => {
    if (trimmed === "") {
      toast.error("DeepResearch の結果 Markdown を貼り付けてください");
      return;
    }
    startStructuring(async () => {
      const res = await structureFromPastedMarkdownAction(store.id, markdown);
      if (res.ok) {
        toast.success(res.message ?? "構造化して保存しました");
        // STEP 2 プレビューを最新化(サーバーで report を再取得)。
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  };

  const onGenerate = () => {
    if (trimmed === "") {
      toast.error("DeepResearch の結果 Markdown を貼り付けてください");
      return;
    }
    startGenerating(async () => {
      const res = await generateCallScriptFromMarkdownAction(store.id, markdown);
      if (res.ok) {
        setAiResult(res.data);
        toast.success("強み・弱み・架電スクリプトを生成しました");
      } else {
        toast.error(res.error);
      }
    });
  };

  const onFieldChange = (key: ScriptFieldKey, value: string) => {
    setAiResult((prev) => (prev ? { ...prev, [key]: value } : prev));
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
      // 既に「架電済み」の店舗は降格させない (structureFromPastedMarkdownAction と同ロジック)。
      const nextStage = store.stage === "架電済み" ? "架電済み" : "DeepResearch済み";
      const res = await updateStorePatchAction(store.id, {
        ai_analysis_result: aiResult,
        stage: nextStage,
      });
      if (res.ok) {
        toast.success("店舗に保存しました");
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
          Gemini の DeepResearch 結果を貼り付け、構造化と架電スクリプト生成を行います。
        </p>
      </div>

      {/* STEP 1: 貼付・構造化 */}
      <Card>
        <Card.Header>
          <Card.Title>STEP 1 ・ DeepResearch 結果を貼付して構造化</Card.Title>
        </Card.Header>
        <Card.Body className="space-y-3">
          <Textarea
            value={markdown}
            onChange={(e) => setMarkdown(e.target.value)}
            rows={12}
            placeholder="Gemini の DeepResearch 結果 Markdown をここに貼り付けてください"
            aria-label="DeepResearch 結果 Markdown"
          />
          <div className="flex justify-end">
            <Button
              type="button"
              variant="primary"
              disabled={busy || trimmed === ""}
              onClick={onStructure}
            >
              {structuring ? "構造化中…" : "構造化して保存"}
            </Button>
          </div>
        </Card.Body>
      </Card>

      {/* STEP 2: 51 項目プレビュー */}
      {initialReport ? (
        <DeepResearchReportView report={initialReport} />
      ) : (
        <Card>
          <Card.Body>
            <p className="text-sm text-muted-foreground">
              STEP 1 で構造化すると、ここに 51 項目(8 カテゴリ)のプレビューが表示されます。
            </p>
          </Card.Body>
        </Card>
      )}

      {/* STEP 3: 架電生成 */}
      <Card>
        <Card.Header>
          <Card.Title>STEP 3 ・ 強み / 弱み / 架電スクリプト</Card.Title>
        </Card.Header>
        <Card.Body className="space-y-4">
          <div className="flex justify-end">
            <Button
              type="button"
              variant="secondary"
              disabled={busy || trimmed === ""}
              onClick={onGenerate}
            >
              {generating
                ? "生成中…"
                : aiResult
                  ? "強み・弱み・架電を再生成"
                  : "強み・弱み・架電を生成"}
            </Button>
          </div>

          {aiResult ? (
            <>
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
                  />
                </div>
              ))}
              <div className="flex justify-end">
                <Button
                  type="button"
                  variant="primary"
                  disabled={busy}
                  onClick={onSave}
                >
                  {saving ? "保存中…" : "保存して店舗へ"}
                </Button>
              </div>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              生成すると、編集可能な強み・弱み・架電スクリプトが表示されます。構造化に失敗していても生成できます。
            </p>
          )}
        </Card.Body>
      </Card>
    </div>
  );
}
