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
  deletePromptTemplateAction,
  setDefaultPromptTemplateAction,
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

type EditableFewShot = FewShotExample & { localId: string };

function toEditable(ex: FewShotExample): EditableFewShot {
  return { ...ex, localId: crypto.randomUUID() };
}

function toEditableNew(): EditableFewShot {
  return { ...createEmptyFewshot(), localId: crypto.randomUUID() };
}

function toFewShotExamples(items: EditableFewShot[]): FewShotExample[] {
  return items.map(({ title, store_meta, call_script_ideal }) => ({
    title,
    store_meta,
    call_script_ideal,
  }));
}

type EditDialogMode =
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
  const [editDialog, setEditDialog] = useState<EditDialogMode | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AiPromptTemplate | null>(null);
  const [changingDefaultId, setChangingDefaultId] = useState<string | null>(null);

  const handleEditSuccess = () => {
    setEditDialog(null);
    router.refresh();
  };

  const handleDeleteSuccess = () => {
    setDeleteTarget(null);
    router.refresh();
  };

  const handleSetDefault = (id: string) => {
    if (changingDefaultId !== null) return;
    setChangingDefaultId(id);
    setDefaultPromptTemplateAction(id)
      .then((result) => {
        if (result.ok) {
          toast.success("デフォルトテンプレートを変更しました");
          router.refresh();
        } else {
          toast.error(result.error);
        }
      })
      .finally(() => {
        setChangingDefaultId(null);
      });
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
          onClick={() => setEditDialog({ mode: "create" })}
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
                onEdit={() => setEditDialog({ mode: "edit", template: t })}
                onDelete={() => setDeleteTarget(t)}
                onSetDefault={handleSetDefault}
                changingDefaultId={changingDefaultId}
              />
            ))}
          </ul>
        )}
      </Card.Body>

      {editDialog !== null && (
        <TemplateDialog
          dialogMode={editDialog}
          onSuccess={handleEditSuccess}
          onClose={() => setEditDialog(null)}
        />
      )}

      {deleteTarget !== null && (
        <DeleteConfirmDialog
          template={deleteTarget}
          onSuccess={handleDeleteSuccess}
          onClose={() => setDeleteTarget(null)}
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
  onDelete,
  onSetDefault,
  changingDefaultId,
}: {
  template: AiPromptTemplate;
  onEdit: () => void;
  onDelete: () => void;
  onSetDefault: (id: string) => void;
  changingDefaultId: string | null;
}) {
  const isChangingThis = changingDefaultId === t.id;
  const isAnyChanging = changingDefaultId !== null;

  return (
    <li className="flex flex-wrap items-center gap-3 px-4 py-3 bg-card">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium truncate">{t.name}</span>
          {t.is_default && <Badge tone="success">デフォルト</Badge>}
        </div>
        <span className="text-xs text-muted-foreground">
          更新: {formatDate(t.updated_at)}
        </span>
      </div>

      <div className="flex items-center gap-1 shrink-0 flex-wrap justify-end">
        {!t.is_default && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onSetDefault(t.id)}
            disabled={isAnyChanging}
            title={isChangingThis ? "変更中…" : "デフォルトにする"}
            aria-label={isChangingThis ? "変更中…" : "デフォルトにする"}
          >
            <Star className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">
              {isChangingThis ? "変更中…" : "デフォルトにする"}
            </span>
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={onEdit}>
          <Pencil className="h-3.5 w-3.5" />
          編集
        </Button>
        {t.is_default ? (
          <Button
            size="sm"
            variant="ghost"
            disabled
            title="デフォルトテンプレートは削除できません"
            className="text-destructive"
          >
            <Trash2 className="h-3.5 w-3.5" />
            削除
          </Button>
        ) : (
          <Button
            size="sm"
            variant="ghost"
            onClick={onDelete}
            className="text-destructive hover:text-destructive hover:bg-destructive/10"
          >
            <Trash2 className="h-3.5 w-3.5" />
            削除
          </Button>
        )}
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Delete confirmation dialog
// ---------------------------------------------------------------------------

interface DeleteConfirmDialogProps {
  template: AiPromptTemplate;
  onSuccess: () => void;
  onClose: () => void;
}

function DeleteConfirmDialog({
  template,
  onSuccess,
  onClose,
}: DeleteConfirmDialogProps) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleDelete = () => {
    setError(null);
    startTransition(async () => {
      const result = await deletePromptTemplateAction(template.id);
      if (result.ok) {
        toast.success("テンプレートを削除しました");
        onSuccess();
      } else {
        setError(result.error);
      }
    });
  };

  return (
    <Modal open onOpenChange={(v) => { if (!v && !isPending) onClose(); }}>
      <ModalContent title="テンプレートを削除" size="sm">
        <p className="text-sm text-foreground">
          <span className="font-medium">「{template.name}」</span>{" "}
          を削除します。この操作は元に戻せません。
        </p>
        {error && (
          <p className="text-sm text-destructive mt-3" role="alert">
            {error}
          </p>
        )}
        <ModalFooter>
          <Button variant="ghost" onClick={onClose} disabled={isPending}>
            キャンセル
          </Button>
          <Button variant="danger" onClick={handleDelete} disabled={isPending}>
            {isPending ? "削除中…" : "削除する"}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Edit / create dialog
// ---------------------------------------------------------------------------

interface TemplateDialogProps {
  dialogMode: EditDialogMode;
  onSuccess: () => void;
  onClose: () => void;
}

function TemplateDialog({ dialogMode, onSuccess, onClose }: TemplateDialogProps) {
  const isEdit = dialogMode.mode === "edit";
  const existing = isEdit ? dialogMode.template : null;

  const [name, setName] = useState(() => (existing ? existing.name : ""));
  const [fewshots, setFewshots] = useState<EditableFewShot[]>(() => {
    if (!existing) return [toEditableNew()];
    const parsed = parseFewshots(existing.body);
    return parsed && parsed.length > 0 ? parsed.map(toEditable) : [toEditableNew()];
  });
  const [parseWarn] = useState<boolean>(() => {
    if (!existing) return false;
    const parsed = parseFewshots(existing.body);
    return parsed === null || parsed.length === 0;
  });
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const updateFewshot = (localId: string, patch: Partial<FewShotExample>) => {
    setFewshots((prev) =>
      prev.map((ex) => (ex.localId === localId ? { ...ex, ...patch } : ex)),
    );
  };

  const addFewshot = () => {
    if (canAddFewshot(fewshots)) {
      setFewshots((prev) => [...prev, toEditableNew()]);
    }
  };

  const removeFewshot = (localId: string) => {
    if (canRemoveFewshot(fewshots)) {
      setFewshots((prev) => prev.filter((ex) => ex.localId !== localId));
    }
  };

  const handleSubmit = () => {
    setError(null);
    const fd = new FormData();
    fd.set("name", name);
    fd.set("body", serializeFewshots(toFewShotExamples(fewshots)));
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
    <Modal open onOpenChange={(v) => { if (!v && !isPending) onClose(); }}>
      <ModalContent
        title={isEdit ? "テンプレートを編集" : "テンプレートを新規作成"}
        description="Few-shot 例を設定することで AI 分析結果をカスタマイズできます。"
        size="lg"
      >
        <div className="max-h-[60vh] overflow-y-auto space-y-6 pr-1">
          {parseWarn && (
            <p className="text-sm text-warning bg-warning/10 rounded p-2" role="alert">
              テンプレートの内容を読み込めませんでした。内容を確認してから保存してください。
            </p>
          )}

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
                key={ex.localId}
                index={i}
                example={ex}
                canRemove={canRemoveFewshot(fewshots)}
                isPending={isPending}
                onChange={(patch) => updateFewshot(ex.localId, patch)}
                onRemove={() => removeFewshot(ex.localId)}
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
  example: EditableFewShot;
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
        required
        htmlFor={`fewshot-title-${example.localId}`}
        hint="例: 居酒屋・海鮮"
      >
        <Input
          id={`fewshot-title-${example.localId}`}
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
        required
        htmlFor={`fewshot-meta-${example.localId}`}
        hint="例: 居酒屋・神奈川県川崎市・刺身/日本酒"
      >
        <Input
          id={`fewshot-meta-${example.localId}`}
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
        required
        htmlFor={`fewshot-script-${example.localId}`}
        hint="{ASSIGNED_SALES} は担当者名のプレースホルダーです（必須）"
      >
        <Textarea
          id={`fewshot-script-${example.localId}`}
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
