"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Plus,
  Pencil,
  Trash2,
  Star,
  FileText,
  X,
  PlusCircle,
} from "lucide-react";
import { Modal, ModalContent, ModalFooter } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FormField } from "@/components/ui/form-field";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Card } from "@/components/ui/card";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils/cn";
import {
  createPromptTemplateAction,
  updatePromptTemplateAction,
} from "@/lib/actions/prompt-template-actions";
import {
  parseFewshots,
  serializeFewshots,
  type AiPromptTemplate,
  type FewShotExample,
} from "@/types/ai-prompt-template";
import { formatDate } from "@/lib/utils/date";
import {
  createEmptyFewshot,
  calculateFewshotLength,
  canAddFewshot,
  canRemoveFewshot,
  MAX_FEWSHOTS,
  MAX_FEWSHOT_LENGTH,
} from "./ai-prompt-template-helpers";

const MAX_TEMPLATES = 5;
const MAX_NAME_LENGTH = 50;

type DialogMode =
  | { mode: "create" }
  | { mode: "edit"; template: AiPromptTemplate };

// ---------------------------------------------------------------------------
// Shell — receives server-fetched data, manages dialog state
// ---------------------------------------------------------------------------

interface ShellProps {
  templates: AiPromptTemplate[];
  isLoggedIn: boolean;
}

export function AiPromptTemplatesShell({ templates, isLoggedIn }: ShellProps) {
  const router = useRouter();
  const [dialog, setDialog] = useState<DialogMode | null>(null);

  const handleSuccess = () => {
    setDialog(null);
    router.refresh();
  };

  return (
    <Card>
      <Card.Header>
        <div>
          <Card.Title>AIプロンプトテンプレート</Card.Title>
          <p className="text-xs text-muted-foreground mt-0.5">
            現在 {templates.length} / {MAX_TEMPLATES} 件
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setDialog({ mode: "create" })}
          disabled={!isLoggedIn || templates.length >= MAX_TEMPLATES}
          title={
            templates.length >= MAX_TEMPLATES
              ? "上限 5 件に達しています"
              : undefined
          }
        >
          <Plus className="h-4 w-4" />
          新規作成
        </Button>
      </Card.Header>

      <Card.Body className="space-y-4">
        <p className="text-sm text-muted-foreground leading-relaxed">
          AI 店舗分析で使用する Few-shot 例を管理します。業種や自社のトーンに合わせた
          Few-shot を設定することで、分析結果をカスタマイズできます。
        </p>

        {!isLoggedIn ? (
          <EmptyState
            icon={<FileText />}
            title="ログインするとテンプレートを管理できます"
            description="AI店舗分析で使うFew-shot例を、ユーザーごとに管理できるようになります。"
          />
        ) : templates.length === 0 ? (
          <EmptyState
            icon={<FileText />}
            title="まだテンプレートはありません"
            description="「新規作成」から Few-shot 例を追加できます。"
          />
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border overflow-hidden">
            {templates.map((t) => (
              <TemplateRow
                key={t.id}
                template={t}
                onEdit={() => setDialog({ mode: "edit", template: t })}
              />
            ))}
          </ul>
        )}
      </Card.Body>

      {dialog !== null && (
        <TemplateDialog
          dialogMode={dialog}
          onSuccess={handleSuccess}
          onClose={() => setDialog(null)}
        />
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Template row
// ---------------------------------------------------------------------------

function TemplateRow({
  template: t,
  onEdit,
}: {
  template: AiPromptTemplate;
  onEdit: () => void;
}) {
  return (
    <li className="flex items-center gap-3 px-4 py-3 bg-card">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium truncate">{t.name}</span>
          {t.is_default && <Badge tone="success">デフォルト</Badge>}
        </div>
        <span className="text-xs text-muted-foreground">
          更新: {formatDate(t.updated_at)}
        </span>
      </div>

      <div className="flex items-center gap-1 shrink-0">
        {!t.is_default && (
          <Button
            size="sm"
            variant="ghost"
            disabled
            title="次フェーズで実装予定"
          >
            <Star className="h-3.5 w-3.5" />
            デフォルトにする
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={onEdit}>
          <Pencil className="h-3.5 w-3.5" />
          編集
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled
          title="次フェーズで実装予定"
          className="text-destructive"
        >
          <Trash2 className="h-3.5 w-3.5" />
          削除
        </Button>
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Dialog (create / edit)
// ---------------------------------------------------------------------------

interface TemplateDialogProps {
  dialogMode: DialogMode;
  onSuccess: () => void;
  onClose: () => void;
}

function TemplateDialog({ dialogMode, onSuccess, onClose }: TemplateDialogProps) {
  const isEdit = dialogMode.mode === "edit";
  const existing = isEdit ? dialogMode.template : null;

  const [name, setName] = useState(() => (existing ? existing.name : ""));
  const [fewshots, setFewshots] = useState<FewShotExample[]>(() => {
    if (!existing) return [createEmptyFewshot()];
    const parsed = parseFewshots(existing.body);
    return parsed && parsed.length > 0 ? parsed : [createEmptyFewshot()];
  });
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const updateFewshot = (index: number, patch: Partial<FewShotExample>) => {
    setFewshots((prev) =>
      prev.map((ex, i) => (i === index ? { ...ex, ...patch } : ex)),
    );
  };

  const addFewshot = () => {
    if (canAddFewshot(fewshots)) {
      setFewshots((prev) => [...prev, createEmptyFewshot()]);
    }
  };

  const removeFewshot = (index: number) => {
    if (canRemoveFewshot(fewshots)) {
      setFewshots((prev) => prev.filter((_, i) => i !== index));
    }
  };

  const handleSubmit = () => {
    setError(null);
    const fd = new FormData();
    fd.set("name", name);
    fd.set("body", serializeFewshots(fewshots));
    if (isEdit && existing) {
      fd.set("id", existing.id);
    }

    startTransition(async () => {
      const result = isEdit
        ? await updatePromptTemplateAction(fd)
        : await createPromptTemplateAction(fd);

      if (result.ok) {
        toast.success(
          isEdit ? "テンプレートを更新しました" : "テンプレートを作成しました",
        );
        onSuccess();
      } else {
        setError(result.error);
      }
    });
  };

  return (
    <Modal open onOpenChange={(v) => { if (!v) onClose(); }}>
      <ModalContent
        title={isEdit ? "テンプレートを編集" : "テンプレートを新規作成"}
        description="Few-shot 例を設定することで AI 分析結果をカスタマイズできます。"
        size="lg"
      >
        <div className="max-h-[60vh] overflow-y-auto space-y-6 pr-1">
          {/* テンプレート名 */}
          <FormField label="テンプレート名" required htmlFor="tpl-name">
            <Input
              id="tpl-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例: 居酒屋・海鮮系"
              maxLength={MAX_NAME_LENGTH}
              disabled={isPending}
            />
            <span className="text-xs text-muted-foreground text-right block">
              {name.length} / {MAX_NAME_LENGTH} 文字
            </span>
          </FormField>

          {/* Few-shot 例リスト */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-foreground">
                Few-shot 例（{fewshots.length} / {MAX_FEWSHOTS} 件）
              </span>
              <Button
                size="sm"
                variant="outline"
                onClick={addFewshot}
                disabled={!canAddFewshot(fewshots) || isPending}
              >
                <PlusCircle className="h-3.5 w-3.5" />
                例を追加
              </Button>
            </div>

            {fewshots.map((ex, i) => (
              <FewShotEditor
                key={i}
                index={i}
                example={ex}
                canRemove={canRemoveFewshot(fewshots)}
                isPending={isPending}
                onChange={(patch) => updateFewshot(i, patch)}
                onRemove={() => removeFewshot(i)}
              />
            ))}
          </div>

          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
        </div>

        <ModalFooter>
          <Button variant="ghost" onClick={onClose} disabled={isPending}>
            キャンセル
          </Button>
          <Button
            variant="primary"
            onClick={handleSubmit}
            disabled={isPending || name.trim().length === 0}
          >
            {isPending ? "保存中…" : isEdit ? "更新する" : "作成する"}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// FewShotEditor — 1件分の入力欄
// ---------------------------------------------------------------------------

interface FewShotEditorProps {
  index: number;
  example: FewShotExample;
  canRemove: boolean;
  isPending: boolean;
  onChange: (patch: Partial<FewShotExample>) => void;
  onRemove: () => void;
}

function FewShotEditor({
  index,
  example,
  canRemove,
  isPending,
  onChange,
  onRemove,
}: FewShotEditorProps) {
  const totalLen = calculateFewshotLength(example);
  const isOverLimit = totalLen > MAX_FEWSHOT_LENGTH;

  return (
    <div
      className={cn(
        "rounded-lg border p-4 space-y-3",
        isOverLimit ? "border-warning" : "border-border",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-muted-foreground">
          例 {index + 1}
        </span>
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "text-xs",
              isOverLimit ? "text-warning font-medium" : "text-muted-foreground",
            )}
          >
            {totalLen.toLocaleString()} / {MAX_FEWSHOT_LENGTH.toLocaleString()} 文字
            {isOverLimit && " ⚠ 上限超過"}
          </span>
          <Button
            size="icon-sm"
            variant="ghost"
            onClick={onRemove}
            disabled={!canRemove || isPending}
            title={canRemove ? "この例を削除" : "最低 1 件必要です"}
            aria-label={`例 ${index + 1} を削除`}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <FormField
        label="タイトル"
        htmlFor={`fewshot-title-${index}`}
        hint="例: 居酒屋・海鮮"
      >
        <Input
          id={`fewshot-title-${index}`}
          value={example.title}
          onChange={(e) => onChange({ title: e.target.value })}
          placeholder="居酒屋・海鮮"
          maxLength={100}
          disabled={isPending}
        />
        <span className="text-xs text-muted-foreground text-right block">
          {example.title.length} / 100 文字
        </span>
      </FormField>

      <FormField
        label="店舗情報"
        htmlFor={`fewshot-meta-${index}`}
        hint="例: 居酒屋・神奈川県川崎市・刺身/日本酒"
      >
        <Input
          id={`fewshot-meta-${index}`}
          value={example.store_meta}
          onChange={(e) => onChange({ store_meta: e.target.value })}
          placeholder="居酒屋・神奈川県川崎市・刺身/日本酒"
          maxLength={500}
          disabled={isPending}
        />
        <span className="text-xs text-muted-foreground text-right block">
          {example.store_meta.length} / 500 文字
        </span>
      </FormField>

      <FormField
        label="架電スクリプト例"
        htmlFor={`fewshot-script-${index}`}
        hint="{ASSIGNED_SALES} は担当者名のプレースホルダーです（必須）"
      >
        <Textarea
          id={`fewshot-script-${index}`}
          value={example.call_script_ideal}
          onChange={(e) => onChange({ call_script_ideal: e.target.value })}
          placeholder={
            "ご準備中にすみません\n私ファーストWEBの{ASSIGNED_SALES}と申しまして..."
          }
          rows={5}
          disabled={isPending}
        />
        {example.call_script_ideal.length > 0 &&
          !example.call_script_ideal.includes("{ASSIGNED_SALES}") && (
            <span className="text-xs text-warning" role="alert">
              {"{ASSIGNED_SALES}"} を含めてください
            </span>
          )}
      </FormField>
    </div>
  );
}
