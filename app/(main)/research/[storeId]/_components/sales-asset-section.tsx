"use client";

/**
 * 営業資産生成セクション(Plan v3.2 §5.6, §5.1, §14)。
 *
 * 53項目レビュー完了後は Primary 導線(強調表示)、未完了時は Secondary 導線
 * (控えめな表示、「現在の情報で生成」)として同じ `generateSalesAssetsAction`
 * (シグネチャ不変)を使う。旧 STEP0(外部Gem)・巨大な貼付テキスト欄は撤去し、
 * 「追加調査メモ(任意)」という短い補足入力に置き換える(Plan §14)。
 *
 * `store.stage` の遷移は行わない。53項目レビュー完了時の遷移
 * (`completeReviewAction`, Plan §15)が本フローの唯一の stage 変更経路であり、
 * 本セクション(現在の情報のみでの生成)はもう`store.stage`を`"DeepResearch済み"`へ
 * 進める役割を持たない(3値化予定の`store.stage`に旧値を書き込む経路を新規に
 * 増やさないための意図的な判断、Plan §15 / PR5 stage migration との整合)。
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Copy, Save, Sparkles } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { generateSalesAssetsAction } from "@/lib/actions/sales-assets-actions";
import { updateStorePatchAction } from "@/lib/actions/store-actions";
import type { Store } from "@/types/store";
import type { AiAnalysisResult } from "@/lib/ai/schema";

const MAX_NOTE_LENGTH = 500;

type ScriptFieldKey = keyof Omit<AiAnalysisResult, "confidence">;
const SCRIPT_FIELDS: ReadonlyArray<{ key: ScriptFieldKey; label: string; rows: number }> = [
  { key: "strengths_markdown", label: "強み (Markdown)", rows: 6 },
  { key: "weaknesses_markdown", label: "弱み (Markdown)", rows: 6 },
  { key: "gourmet_paid_status", label: "グルメサイト課金状況", rows: 3 },
  { key: "gbp_completeness", label: "GBP 充実度", rows: 4 },
  { key: "call_script", label: "架電スクリプト", rows: 10 },
];

export function SalesAssetSection({
  store,
  reviewCompleted,
}: {
  store: Store;
  reviewCompleted: boolean;
}) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [aiResult, setAiResult] = useState<AiAnalysisResult | null>(store.ai_analysis_result);
  const [persisted, setPersisted] = useState(true);
  const [generating, startGenerating] = useTransition();
  const [saving, startSaving] = useTransition();
  const busy = generating || saving;

  const onGenerate = () => {
    startGenerating(async () => {
      const res = await generateSalesAssetsAction(store.id, "", note);
      if (res.ok) {
        setAiResult(res.data);
        setPersisted(true);
        toast.success(res.message ?? "営業資産を生成しました");
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
      const res = await updateStorePatchAction(store.id, { ai_analysis_result: aiResult });
      if (res.ok) {
        toast.success("店舗に保存しました");
        setPersisted(true);
      } else {
        toast.error(res.error);
      }
    });
  };

  return (
    <Card className={reviewCompleted ? "border-primary/40" : undefined}>
      <Card.Header>
        <Card.Title>
          {reviewCompleted ? "営業資産を生成" : "営業資産を生成(現在の基本情報のみ)"}
        </Card.Title>
      </Card.Header>
      <Card.Body className="space-y-4">
        {!reviewCompleted && (
          <p className="text-sm text-muted-foreground">
            AI調査・レビューを行うとより精度の高い営業資産を生成できます。今すぐ生成することもできます。
          </p>
        )}
        <div className="space-y-1.5">
          <label htmlFor="additional-note" className="text-sm font-medium text-foreground">
            追加調査メモ(任意)
          </label>
          <Textarea
            id="additional-note"
            value={note}
            onChange={(e) => setNote(e.target.value.slice(0, MAX_NOTE_LENGTH))}
            rows={3}
            placeholder="AI調査で拾いきれなかった一次情報があれば入力してください"
            aria-label="追加調査メモ"
            disabled={busy}
          />
          <p className="text-xs text-muted-foreground text-right">
            {note.length}/{MAX_NOTE_LENGTH}
          </p>
        </div>

        <div className="flex justify-end">
          <Button type="button" variant={reviewCompleted ? "primary" : "secondary"} onClick={onGenerate} disabled={busy}>
            <Sparkles className="h-3.5 w-3.5" />
            {generating
              ? "生成中…"
              : aiResult
                ? "強み・弱み・架電を再生成"
                : reviewCompleted
                  ? "強み・弱み・架電を生成"
                  : "現在の情報で生成"}
          </Button>
        </div>

        {aiResult ? (
          <div className="space-y-4 border-t border-border pt-4">
            {SCRIPT_FIELDS.map((f) => (
              <div key={f.key} className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label htmlFor={`ai-${f.key}`} className="text-sm font-medium text-foreground">
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
              {!persisted && <span className="text-xs text-warning">未保存の変更があります</span>}
              <Button type="button" variant="primary" onClick={onSave} disabled={busy || persisted}>
                <Save className="h-3.5 w-3.5" />
                {saving ? "保存中…" : "保存"}
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
  );
}
