"use client";

/**
 * AI 分析 Panel コンポーネント。
 *
 * 役割:
 * - [AI で分析] CTA + 自由追加指示 textarea を上部に配置
 * - `analyzeStoreAction` を `useTransition` で呼出し、pending 中は CTA disabled
 * - 結果は 5 エリア(Markdown 2 + プレーンテキスト 3)で表示・編集可
 * - 各エリアに `confidenceToBg` で背景色グラデーション、`confidence < 50` で警告
 * - 架電スクリプトには「クリップボードへコピー」ボタン
 * - API キー未設定時は CTA disabled + tooltip
 * - **コスト/トークン数の UI 表示は組み込まない**(Req 6.5)
 *
 * 関連: design.md §「AiAnalysisPanel」, requirements.md §2.1, §2.2, §2.5, §2.7, §2.8,
 *       §4.1〜4.6, §5.2〜5.4, §6.1, §6.2, §6.5
 */

import {
  useState,
  useTransition,
  type ChangeEvent,
  type CSSProperties,
} from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { FormField } from "@/components/ui/form-field";
import { toast } from "@/components/ui/toast";
import { Copy, AlertTriangle, Sparkles } from "lucide-react";
import { analyzeStoreAction } from "@/lib/actions/ai-analysis-actions";
import { confidenceToBg } from "@/lib/url-parser/confidence-color";
import type {
  AiAnalysisResult,
  AiAnalysisConfidence,
  ConfidenceFieldKey,
} from "@/types/ai-analysis";

const MAX_INSTRUCTIONS_LENGTH = 500;
const WARNING_THRESHOLD = 50;

export interface PromptTemplateOption {
  id: string;
  name: string;
  is_default: boolean;
}

/**
 * 親 form の現在値スナップショット。`AiAnalysisPanel` は押下時にこれを取得して
 * Server Action へ送信する。閉包の古さを避けるため、親側で `useState` 直アクセスの
 * callback として実装すること。
 */
export interface AiAnalysisFormSnapshot {
  name: string;
  prefecture: string;
  city: string;
  address: string;
  genre: string;
  phone: string;
  site_url: string;
  instagram_url: string;
  map_url: string;
  review_avg: string;
  review_count: string;
  memo: string;
  operator_type: string;
  operator_name: string;
  htmlContent: string | null;
  assignedSales: string;
}

export interface AiAnalysisPanelProps {
  /** 親 form の現在値スナップショット取得(押下時に呼ばれる) */
  getFormSnapshot: () => AiAnalysisFormSnapshot;
  /** 編集モード時の初期 AI 結果(Req 5.2) */
  initialResult: AiAnalysisResult | null;
  /** AI 分析成功時に親に通知 */
  onResult: (result: AiAnalysisResult) => void;
  /** 編集トリガで親 confidence をリセット(背景色解除、Req 4.4 / 5.4) */
  onFieldEdit: (field: ConfidenceFieldKey) => void;
  /** API キー設定有無(Req 2.7) */
  isApiKeyConfigured: boolean;
  /** 編集中の現在値(親 form と同期、5.4 表示用) */
  currentResult: AiAnalysisResult | null;
  /** 各フィールドの現在 confidence(undefined 時は背景色なし) */
  confidence: Partial<AiAnalysisConfidence>;
  /** 結果フィールドの編集 onChange */
  onResultFieldChange: (
    field: keyof Omit<AiAnalysisResult, "confidence">,
    value: string,
  ) => void;
  /** storeId(編集モード) — レート制限のキー */
  storeId: string | null;
  /** SSR で取得したプロンプトテンプレート一覧(Issue #42 Phase 4-D) */
  promptTemplates: readonly PromptTemplateOption[];
  /**
   * 当該店舗に Deep Research レポートが存在するか。
   * true かつ storeId ありのときのみ「結果をプロンプトに含める」チェックボックスを表示。
   */
  hasDeepResearchReport?: boolean;
}

const FIELD_DEFS: Array<{
  key: keyof Omit<AiAnalysisResult, "confidence">;
  confidenceKey: ConfidenceFieldKey;
  label: string;
  hint: string;
  rows: number;
  withCopy?: boolean;
}> = [
  {
    key: "strengths_markdown",
    confidenceKey: "strengths",
    label: "強み (Markdown)",
    hint: "見出しは ## まで、箇条書きは - を使用。コードブロック禁止。",
    rows: 6,
  },
  {
    key: "weaknesses_markdown",
    confidenceKey: "weaknesses",
    label: "弱み (Markdown)",
    hint: "同上の規約。",
    rows: 6,
  },
  {
    key: "gourmet_paid_status",
    confidenceKey: "gourmet_paid_status",
    label: "グルメサイト課金状況 (プレーンテキスト)",
    hint: "食べログ 050 番号判定等。1〜3 行。",
    rows: 3,
  },
  {
    key: "gbp_completeness",
    confidenceKey: "gbp_completeness",
    label: "GBP 充実度 (プレーンテキスト)",
    hint: "説明欄 / 口コミ返信 / メニュー / 最近の写真の有無を箇条書き。",
    rows: 4,
  },
  {
    key: "call_script",
    confidenceKey: "call_script",
    label: "架電スクリプト (プレーンテキスト・1500 字以内)",
    hint: "冒頭は assigned_sales 名を差し込んだ自己紹介で開始。",
    rows: 12,
    withCopy: true,
  },
];

function buildFormDataFromSnapshot(
  snap: AiAnalysisFormSnapshot,
  additionalInstructions: string,
  storeId: string | null,
  templateId: string,
  includeDeepResearch: boolean,
): FormData {
  const fd = new FormData();
  fd.set("name", snap.name);
  fd.set("prefecture", snap.prefecture);
  fd.set("city", snap.city);
  fd.set("address", snap.address);
  fd.set("genre", snap.genre);
  fd.set("phone", snap.phone);
  fd.set("site_url", snap.site_url);
  fd.set("instagram_url", snap.instagram_url);
  fd.set("map_url", snap.map_url);
  fd.set("review_avg", snap.review_avg);
  fd.set("review_count", snap.review_count);
  fd.set("memo", snap.memo);
  fd.set("operator_type", snap.operator_type);
  fd.set("operator_name", snap.operator_name);
  fd.set("htmlContent", snap.htmlContent ?? "");
  fd.set("additionalInstructions", additionalInstructions);
  fd.set("assignedSales", snap.assignedSales);
  fd.set("storeId", storeId ?? "");
  fd.set("includeDeepResearch", includeDeepResearch ? "true" : "false");
  if (templateId) {
    fd.set("templateId", templateId);
  }
  return fd;
}

export function AiAnalysisPanel({
  getFormSnapshot,
  initialResult,
  onResult,
  onFieldEdit,
  isApiKeyConfigured,
  currentResult,
  confidence,
  onResultFieldChange,
  storeId,
  promptTemplates,
  hasDeepResearchReport = false,
}: AiAnalysisPanelProps) {
  // 自由追加指示 (再実行間で保持、Req 2.8)
  const [additionalInstructions, setAdditionalInstructions] = useState("");
  // Deep Research 結果をプロンプトに含めるか (レポート存在時のみ UI 表示、初期 ON)
  const canIncludeDeepResearch = Boolean(storeId) && hasDeepResearchReport;
  const [includeDeepResearch, setIncludeDeepResearch] = useState(true);
  // デフォルトテンプレートがあれば初期選択、なければ標準テンプレート (Issue #42 Phase 4-D)
  const [templateId, setTemplateId] = useState<string>(() => {
    const def = promptTemplates.find((t) => t.is_default);
    return def ? def.id : "";
  });
  const [pending, startTransition] = useTransition();

  // 表示用フォールバック: currentResult が無いがマウント時に initialResult があれば
  // 親側で currentResult として保持してくる前提(復元は親 form 側の役割)。
  // initialResult は currentResult が undefined のときの読み取り専用フォールバック。
  const display = currentResult ?? initialResult;

  const onAnalyze = () => {
    if (!isApiKeyConfigured) return;
    const snap = getFormSnapshot();
    if (!snap.name.trim()) {
      toast.error("店舗名を入力してください");
      return;
    }
    const fd = buildFormDataFromSnapshot(
      snap,
      additionalInstructions,
      storeId,
      templateId,
      canIncludeDeepResearch && includeDeepResearch,
    );
    startTransition(async () => {
      const result = await analyzeStoreAction(fd);
      if (result.ok) {
        onResult(result.data);
        if (result.message) {
          toast.warn(result.message);
        } else {
          toast.success("AI 分析が完了しました");
        }
      } else {
        toast.error(result.error);
      }
    });
  };

  const onCopyCallScript = async () => {
    const text = display?.call_script ?? "";
    if (!text) {
      toast.error("コピーする内容がありません");
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      toast.success("架電スクリプトをコピーしました");
    } catch {
      toast.error("クリップボードへのコピーに失敗しました");
    }
  };

  const bgStyleFor = (key: ConfidenceFieldKey): CSSProperties | undefined => {
    const score = confidence[key];
    const bg = confidenceToBg(score);
    // confidenceToBg は lightness 92% の薄い背景色を返すため、ダークモードでも
    // 必ず濃い文字色 (slate-900 相当) を強制してコントラストを確保する。
    return bg ? { backgroundColor: bg, color: "hsl(222 47% 11%)" } : undefined;
  };

  const isLowConfidence = (key: ConfidenceFieldKey): boolean => {
    const score = confidence[key];
    return typeof score === "number" && score < WARNING_THRESHOLD;
  };

  const onEditField = (
    field: keyof Omit<AiAnalysisResult, "confidence">,
    confidenceKey: ConfidenceFieldKey,
  ) => (e: ChangeEvent<HTMLTextAreaElement>) => {
    onResultFieldChange(field, e.target.value);
    onFieldEdit(confidenceKey);
  };

  const ctaDisabled = pending || !isApiKeyConfigured;
  const ctaTooltip = !isApiKeyConfigured
    ? "環境変数 GEMINI_API_KEY が未設定のため AI 分析は無効です。"
    : pending
      ? "AI 分析を実行中…"
      : "現在のフォーム内容で AI 分析を実行";

  return (
    <Card>
      <Card.Header>
        <Card.Title>AI 分析</Card.Title>
      </Card.Header>
      <Card.Body className="space-y-4">
        {/* プロンプトテンプレート選択 (Issue #42 Phase 4-D) */}
        {promptTemplates.length > 0 && (
          <FormField
            label="使用するプロンプトテンプレート"
            htmlFor="promptTemplate"
            hint="未選択の場合は標準テンプレートを使用します。"
          >
            <Select
              id="promptTemplate"
              value={templateId}
              onChange={(e) => setTemplateId(e.target.value)}
            >
              <option value="">標準テンプレート（既定）</option>
              {promptTemplates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                  {t.is_default ? "（デフォルト）" : ""}
                </option>
              ))}
            </Select>
          </FormField>
        )}

        {/* Deep Research 結果のオプトイン (レポート存在時のみ) */}
        {canIncludeDeepResearch && (
          <label className="flex items-start gap-2.5 rounded-md border border-border bg-muted/30 px-3 py-2.5 cursor-pointer">
            <input
              type="checkbox"
              checked={includeDeepResearch}
              onChange={(e) => setIncludeDeepResearch(e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
            />
            <span className="text-sm leading-snug">
              <span className="font-medium text-foreground">
                Deep Research の結果をプロンプトに含める
              </span>
              <span className="block text-xs text-muted-foreground mt-0.5">
                この店舗の Deep Research レポート(8 カテゴリの詳細調査)を AI 分析の参考情報として与えます。
              </span>
            </span>
          </label>
        )}

        {/* CTA + 自由追加指示 */}
        <FormField
          label="追加指示 (任意・最大 500 字)"
          htmlFor="additionalInstructions"
          hint="例: 「コスパ不満を重点的に」「○○エリアの営業向けに調整」"
        >
          <Textarea
            id="additionalInstructions"
            name="additionalInstructions"
            rows={3}
            value={additionalInstructions}
            onChange={(e) =>
              setAdditionalInstructions(
                e.target.value.slice(0, MAX_INSTRUCTIONS_LENGTH),
              )
            }
            maxLength={MAX_INSTRUCTIONS_LENGTH}
            placeholder="AI への補足指示があればここに記入"
          />
        </FormField>
        <div className="flex items-center gap-3">
          <Button
            type="button"
            variant="primary"
            onClick={onAnalyze}
            disabled={ctaDisabled}
            title={ctaTooltip}
          >
            <Sparkles className="h-4 w-4" aria-hidden />
            {pending ? "AI 分析中…" : "AI で分析"}
          </Button>
          {!isApiKeyConfigured && (
            <span className="text-xs text-muted-foreground">
              GEMINI_API_KEY が未設定のため無効
            </span>
          )}
          <span className="text-xs text-muted-foreground">
            {additionalInstructions.length} / {MAX_INSTRUCTIONS_LENGTH} 字
          </span>
        </div>

        {/* 結果表示 5 エリア(display が null なら空状態 = 何も描画しない) */}
        {display !== null && (
          <div className="space-y-4 pt-2 border-t border-border">
            {FIELD_DEFS.map((def) => {
              const value = display[def.key];
              const showWarning = isLowConfidence(def.confidenceKey);
              return (
                <FormField
                  key={def.key}
                  label={
                    <span className="inline-flex items-center gap-2">
                      {def.label}
                      {showWarning && (
                        <span
                          className="inline-flex items-center gap-1 text-warning text-xs"
                          aria-label="要確認"
                        >
                          <AlertTriangle className="h-3 w-3" aria-hidden />
                          要確認
                        </span>
                      )}
                    </span>
                  }
                  htmlFor={`ai_${def.key}`}
                  hint={def.hint}
                >
                  <Textarea
                    id={`ai_${def.key}`}
                    rows={def.rows}
                    value={value}
                    onChange={onEditField(def.key, def.confidenceKey)}
                    style={bgStyleFor(def.confidenceKey)}
                  />
                  {def.withCopy && (
                    <div className="mt-2">
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={onCopyCallScript}
                      >
                        <Copy className="h-3 w-3" aria-hidden />
                        クリップボードへコピー
                      </Button>
                    </div>
                  )}
                </FormField>
              );
            })}
          </div>
        )}
      </Card.Body>
    </Card>
  );
}
