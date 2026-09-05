"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Plus,
  Pencil,
  Trash2,
  Star,
  FileText,
  X,
  PlusCircle,
  Eye,
} from "lucide-react";
import { Modal, ModalContent, ModalFooter } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { useIsAdmin } from "@/components/layout/current-user-provider";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FormField } from "@/components/ui/form-field";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsPanel } from "@/components/ui/tabs";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils/cn";
import {
  createPromptTemplateAction,
  updatePromptTemplateAction,
  deletePromptTemplateAction,
  setDefaultPromptTemplateAction,
} from "@/lib/actions/prompt-template-actions";
import {
  parseTemplateBody,
  serializeFewshots,
  serializeFreeform,
  type AiPromptTemplate,
  type FewShotExample,
  type PromptTemplateKind,
} from "@/types/ai-prompt-template";
import { formatDate } from "@/lib/utils/date";
import {
  createEmptyFewshot,
  calculateFewshotLength,
  canAddFewshot,
  canRemoveFewshot,
  MAX_FEWSHOTS,
  MAX_FEWSHOT_LENGTH,
  MAX_FREEFORM_LENGTH,
} from "./ai-prompt-template-helpers";
import {
  BUILTIN_FEWSHOT_EXAMPLES,
  BUILTIN_PROMPT_TEMPLATE_NAME,
} from "@/lib/ai/builtin-prompt-template";

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
  | { mode: "edit"; template: AiPromptTemplate }
  | { mode: "view"; builtin: true };

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
          AI 店舗分析で使用するテンプレートを管理します。構造化された Few-shot 例、
          または自由記述テキストで、業種や自社のトーンに合わせて分析結果をカスタマイズできます。
        </p>

        {!isLoggedIn ? (
          <EmptyState
            icon={<FileText />}
            title="ログインするとテンプレートを管理できます"
            description="AI店舗分析で使うFew-shot例や自由記述テキストを、ユーザーごとに管理できるようになります。"
          />
        ) : null}

        <ul className="divide-y divide-border rounded-lg border border-border overflow-hidden">
          <BuiltinTemplateRow onView={() => setEditDialog({ mode: "view", builtin: true })} />
          {isLoggedIn &&
            templates.map((t) => (
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

        {isLoggedIn && templates.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            カスタムテンプレートはまだありません。「新規作成」から追加できます。
          </p>
        ) : null}
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
// Built-in template row (view-only)
// ---------------------------------------------------------------------------

function BuiltinTemplateRow({ onView }: { onView: () => void }) {
  return (
    <li className="flex flex-wrap items-center gap-3 px-4 py-3 bg-card">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium truncate">
            {BUILTIN_PROMPT_TEMPLATE_NAME}
          </span>
          <Badge tone="success">標準</Badge>
        </div>
        <span className="text-xs text-muted-foreground">システム提供</span>
      </div>

      <div className="flex items-center gap-1 shrink-0 flex-wrap justify-end">
        <Button size="sm" variant="ghost" onClick={onView}>
          <Eye className="h-3.5 w-3.5" />
          閲覧
        </Button>
      </div>
    </li>
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
  // #155: テンプレート削除は admin 限定 (真の防御はサーバ側 requireAdmin)。
  const { isAdmin, loaded } = useIsAdmin();
  const denyDelete = loaded && !isAdmin;

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
            disabled={denyDelete}
            title={denyDelete ? "管理者のみ実行できます" : undefined}
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
  const isView = dialogMode.mode === "view";
  const isEdit = dialogMode.mode === "edit";
  const existing = isEdit ? dialogMode.template : null;

  // 編集時は既存 body を一度だけパースして種別・初期値を決める
  const parsedBody = useMemo(() => {
    if (isView) {
      return { kind: "fewshots" as const, fewshots: [...BUILTIN_FEWSHOT_EXAMPLES] };
    }
    return existing ? parseTemplateBody(existing.body) : null;
  }, [existing, isView]);

  const [kind, setKind] = useState<PromptTemplateKind>(() =>
    parsedBody?.kind === "freeform" ? "freeform" : "fewshots",
  );
  const [name, setName] = useState(() => {
    if (isView) return BUILTIN_PROMPT_TEMPLATE_NAME;
    return existing ? existing.name : "";
  });
  const [fewshots, setFewshots] = useState<EditableFewShot[]>(() => {
    const fs = parsedBody?.kind === "fewshots" ? parsedBody.fewshots : null;
    return fs && fs.length > 0 ? fs.map(toEditable) : [toEditableNew()];
  });
  const [freeText, setFreeText] = useState<string>(() =>
    parsedBody?.kind === "freeform" ? parsedBody.text : "",
  );
  const [parseWarn] = useState<boolean>(
    () => !isView && existing != null && parsedBody === null,
  );
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

  const canSubmit =
    name.trim().length > 0 &&
    (kind === "freeform" ? freeText.trim().length > 0 : true);

  const handleSubmit = () => {
    setError(null);
    const fd = new FormData();
    fd.set("name", name);
    fd.set(
      "body",
      kind === "freeform"
        ? serializeFreeform(freeText)
        : serializeFewshots(toFewShotExamples(fewshots)),
    );
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
        title={
          isView
            ? "テンプレートを閲覧"
            : isEdit
              ? "テンプレートを編集"
              : "テンプレートを新規作成"
        }
        description={
          isView
            ? "標準テンプレートは閲覧のみ可能です。編集・削除はできません。"
            : "Few-shot 例、または自由記述テキストで AI 分析結果をカスタマイズできます。"
        }
        size="lg"
      >
        {/* 高さとスクロールは ModalContent が一元管理する (#225 Phase 1)。
            ここで独自の max-h / overflow-y を持つと入れ子スクロールになる。 */}
        <div className="space-y-6 pr-1">
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
              disabled={isPending || isView}
              readOnly={isView}
            />
            {!isView && (
              <span className="text-xs text-muted-foreground text-right block">
                {name.length} / {MAX_NAME_LENGTH} 文字
              </span>
            )}
          </FormField>

          <Tabs
            defaultValue={kind}
            value={kind}
            onValueChange={(v) => {
              if (!isView) setKind(v as PromptTemplateKind);
            }}
          >
            <TabsList>
              <TabsTrigger value="fewshots" disabled={isPending || isView}>
                Few-shot 形式
              </TabsTrigger>
              <TabsTrigger
                value="freeform"
                disabled={isPending || isView}
              >
                自由記述
              </TabsTrigger>
            </TabsList>

            <TabsPanel value="fewshots" className="space-y-4">
              <p className="text-xs text-muted-foreground leading-relaxed">
                入出力例（タイトル・店舗情報・理想の架電スクリプト）を 1〜
                {MAX_FEWSHOTS} 件登録します。AI に文体を学習させたい場合に向いています。
              </p>
              {!isView && (
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
              )}

              {isView ? (
                <span className="text-xs font-semibold text-foreground block">
                  Few-shot 例（{fewshots.length} 件）
                </span>
              ) : null}

              {fewshots.map((ex, i) => (
                <FewShotEditor
                  key={ex.localId}
                  index={i}
                  example={ex}
                  canRemove={canRemoveFewshot(fewshots)}
                  isPending={isPending}
                  readOnly={isView}
                  onChange={(patch) => updateFewshot(ex.localId, patch)}
                  onRemove={() => removeFewshot(ex.localId)}
                />
              ))}
            </TabsPanel>

            <TabsPanel value="freeform" className="space-y-4">
              <FormField
                label="テンプレート本文"
                required
                htmlFor="tpl-freeform"
                hint="AI への指示や理想の架電スクリプトを自由に記述できます。{ASSIGNED_SALES} と書くと担当者名に自動で置き換わります（任意）。"
              >
                <Textarea
                  id="tpl-freeform"
                  value={freeText}
                  onChange={(e) => setFreeText(e.target.value)}
                  placeholder={
                    "例:\n落ち着いた丁寧なトーンで分析してください。\n架電スクリプトは「ご準備中にすみません」で始め、\n私ファーストWEBの{ASSIGNED_SALES}と申しまして…と続けてください。"
                  }
                  rows={12}
                  maxLength={MAX_FREEFORM_LENGTH}
                  disabled={isPending || isView}
                  readOnly={isView}
                />
                {!isView && (
                  <span
                    className={cn(
                      "text-xs text-right block",
                      freeText.length > MAX_FREEFORM_LENGTH
                        ? "text-warning font-medium"
                        : "text-muted-foreground",
                    )}
                  >
                    {freeText.length.toLocaleString()} /{" "}
                    {MAX_FREEFORM_LENGTH.toLocaleString()} 文字
                  </span>
                )}
              </FormField>
            </TabsPanel>
          </Tabs>

          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
        </div>

        <ModalFooter>
          <Button variant="ghost" onClick={onClose} disabled={isPending}>
            {isView ? "閉じる" : "キャンセル"}
          </Button>
          {!isView && (
            <Button
              variant="primary"
              onClick={handleSubmit}
              disabled={isPending || !canSubmit}
            >
              {isPending ? "保存中…" : isEdit ? "更新する" : "作成する"}
            </Button>
          )}
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
  readOnly?: boolean;
  onChange: (patch: Partial<FewShotExample>) => void;
  onRemove: () => void;
}

function FewShotEditor({
  index,
  example,
  canRemove,
  isPending,
  readOnly = false,
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
          {!readOnly && (
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
          )}
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
          disabled={isPending || readOnly}
          readOnly={readOnly}
        />
        {!readOnly && (
          <span className="text-xs text-muted-foreground text-right block">
            {example.title.length} / 100 文字
          </span>
        )}
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
          disabled={isPending || readOnly}
          readOnly={readOnly}
        />
        {!readOnly && (
          <span className="text-xs text-muted-foreground text-right block">
            {example.store_meta.length} / 500 文字
          </span>
        )}
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
          disabled={isPending || readOnly}
          readOnly={readOnly}
        />
        {!readOnly &&
          example.call_script_ideal.length > 0 &&
          !example.call_script_ideal.includes("{ASSIGNED_SALES}") && (
            <span className="text-xs text-warning" role="alert">
              {"{ASSIGNED_SALES}"} を含めてください
            </span>
          )}
      </FormField>
    </div>
  );
}
