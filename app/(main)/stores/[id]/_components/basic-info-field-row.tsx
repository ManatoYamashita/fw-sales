"use client";

/**
 * 基本情報 1 項目の表示・編集行 (Client Component, store-basic-info / task 3.3, PR2)
 *
 * `BasicInfoFieldsCard` (Server) の各項目をレンダリングし、ユーザーの inline 編集に
 * 対応する。編集モードでは `<textarea>` を表示し、保存時に
 * `updateBasicInfoFieldAction` を呼ぶ。`mergeBasicInfo(..., "manual")` 強制により
 * `filled_by="manual"` で保存され、以後の自動充填(Places 等)で当該項目が
 * 上書きされない(R5.1 / R6.2)。
 *
 * 関連: design.md §UI / BasicInfoCard, requirements.md §6.1 §6.2
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Save, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { updateBasicInfoFieldAction } from "@/lib/actions/basic-info-actions";
import type {
  BasicInfoItemDef,
  DifficultyTier,
} from "@/lib/domain/basic-info-items";
import type { BasicInfoField, FillSource } from "@/types/basic-info";

// ---- ラベル / スタイル(read-only Card と一致) -----------------------------

const TIER_LABEL: Record<DifficultyTier, string> = {
  A: "高信頼",
  B: "推定",
  C: "ヒアリング必須",
};

const TIER_CLASS: Record<DifficultyTier, string> = {
  A: "bg-emerald-50 text-emerald-700 border-emerald-200",
  B: "bg-amber-50 text-amber-700 border-amber-200",
  C: "bg-rose-50 text-rose-700 border-rose-200",
};

const SOURCE_LABEL: Record<FillSource, string> = {
  places: "エリア検索",
  manual: "手動入力",
};

// ---- ヘルパ --------------------------------------------------------------

function isFilled(field: BasicInfoField | undefined): boolean {
  if (!field) return false;
  if (field.value === null) return false;
  if (field.value.trim() === "") return false;
  return true;
}

// ---- Props ---------------------------------------------------------------

export interface BasicInfoFieldRowProps {
  storeId: string;
  def: BasicInfoItemDef;
  field: BasicInfoField | undefined;
}

// ---- 行コンポーネント ----------------------------------------------------

export function BasicInfoFieldRow({
  storeId,
  def,
  field,
}: BasicInfoFieldRowProps) {
  const router = useRouter();
  const filled = isFilled(field);
  const tier: DifficultyTier = field?.tier ?? def.default_tier;

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string>(field?.value ?? "");
  const [pending, startTransition] = useTransition();

  const onEdit = () => {
    setDraft(field?.value ?? "");
    setEditing(true);
  };

  const onCancel = () => {
    setEditing(false);
    setDraft(field?.value ?? "");
  };

  const onSave = () => {
    startTransition(async () => {
      const result = await updateBasicInfoFieldAction(storeId, def.key, draft);
      if (result.ok) {
        toast.success(result.message ?? "更新しました");
        setEditing(false);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  };

  // 編集モード ------------------------------------------------------------
  if (editing) {
    return (
      <li className="text-sm">
        <div className="flex items-center gap-2 flex-wrap">
          <label
            htmlFor={`basic-info-${def.key}`}
            className="font-medium text-foreground"
          >
            {def.label}
          </label>
          <span
            className={`text-[10px] px-1.5 py-0.5 rounded border ${TIER_CLASS[tier]}`}
          >
            {tier}・{TIER_LABEL[tier]}
          </span>
        </div>
        <div className="mt-1 space-y-2">
          <Textarea
            id={`basic-info-${def.key}`}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={2}
            disabled={pending}
            placeholder="(空のまま保存すると未充足に戻ります)"
            aria-label={`${def.label} を編集`}
          />
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onCancel}
              disabled={pending}
            >
              <X className="h-3.5 w-3.5" /> キャンセル
            </Button>
            <Button
              type="button"
              variant="primary"
              size="sm"
              onClick={onSave}
              disabled={pending}
            >
              <Save className="h-3.5 w-3.5" />
              {pending ? "保存中…" : "保存(手動入力として記録)"}
            </Button>
          </div>
        </div>
      </li>
    );
  }

  // 閲覧モード ------------------------------------------------------------
  return (
    <li className="text-sm">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="font-medium text-foreground">{def.label}</span>
        <span
          className={`text-[10px] px-1.5 py-0.5 rounded border ${TIER_CLASS[tier]}`}
          aria-label={`取得難易度 ${tier} ${TIER_LABEL[tier]}`}
        >
          {tier}・{TIER_LABEL[tier]}
        </span>
        {filled && field && field.filled_by && (
          <span className="text-[10px] text-muted-foreground">
            取得ソース: {SOURCE_LABEL[field.filled_by]}
          </span>
        )}
        <button
          type="button"
          onClick={onEdit}
          className="ml-auto inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground"
          aria-label={`${def.label} を編集`}
        >
          <Pencil className="h-3 w-3" /> 編集
        </button>
      </div>

      <div className="mt-0.5">
        {filled && field ? (
          <span className="text-foreground whitespace-pre-wrap break-words">
            {field.value}
          </span>
        ) : (
          <span
            className="text-muted-foreground italic"
            aria-label="未充足"
          >
            — 未充足 —
          </span>
        )}
      </div>

      {/* tier=B のメタ */}
      {filled && field && field.tier === "B" && (
        <div className="mt-1 text-xs text-muted-foreground space-y-0.5">
          {typeof field.confidence === "number" && (
            <div>確信度: {field.confidence}</div>
          )}
          {field.source_urls && field.source_urls.length > 0 && (
            <div>
              出典 URL:{" "}
              {field.source_urls.map((url, i) => (
                <span key={url}>
                  {i > 0 && " / "}
                  <a
                    href={url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-primary hover:underline break-all"
                  >
                    {url}
                  </a>
                </span>
              ))}
            </div>
          )}
          {field.source_quote && field.source_quote.trim() !== "" && (
            <div className="whitespace-pre-wrap break-words">
              抜粋:「{field.source_quote.trim()}」
            </div>
          )}
        </div>
      )}

      {/* tier=C のヒアリング質問 (未充足時) */}
      {!filled &&
        tier === "C" &&
        field &&
        field.hearing_question &&
        field.hearing_question.trim() !== "" && (
          <div className="mt-1 text-xs text-muted-foreground">
            <span className="font-medium">ヒアリング質問: </span>
            <span className="whitespace-pre-wrap break-words">
              {field.hearing_question.trim()}
            </span>
          </div>
        )}
    </li>
  );
}
