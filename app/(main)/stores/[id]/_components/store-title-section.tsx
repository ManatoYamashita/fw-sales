"use client";

import { useState, useTransition, type ChangeEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Pencil, X, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { IndividualStoreBadge } from "@/components/feature/individual-store-badge";
import { ResearchPhaseBadge } from "./research-phase-badge";
import { NextActionCta } from "./next-action-cta";
import { runAction } from "@/lib/client/run-action";
import { updateStorePatchAction } from "@/lib/actions/store-actions";
import { splitStoreNameMemo } from "@/lib/domain/store-name-memo";
import type { ResearchPhase } from "@/lib/domain/store-research-phase";
import type { Store, StorePatch } from "@/types/store";

export function StoreTitleSection({
  store,
  phase,
}: {
  store: Store;
  phase: ResearchPhase;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState({ name: store.name, genre: store.genre });
  const [nameError, setNameError] = useState<string | undefined>();
  const nameMemo = splitStoreNameMemo(store.name);

  const onText =
    (key: keyof typeof form) =>
    (e: ChangeEvent<HTMLTextAreaElement>) => {
      setForm((prev) => ({ ...prev, [key]: e.target.value }));
      if (key === "name") setNameError(undefined);
    };

  const onCancel = () => {
    setForm({ name: store.name, genre: store.genre });
    setNameError(undefined);
    setEditing(false);
  };

  const onSave = () => {
    if (!form.name.trim()) {
      setNameError("店舗名を入力してください");
      document.getElementById("store_name")?.focus();
      return;
    }
    setNameError(undefined);
    const patch: StorePatch = { ...form };
    startTransition(async () => {
      const result = await runAction(() => updateStorePatchAction(store.id, patch), {
        success: "更新しました",
      });
      if (result?.ok) {
        setEditing(false);
        router.refresh();
      }
    });
  };

  const location = [store.prefecture, store.city].filter(Boolean).join(" / ");

  return (
    <div>
      <h1 className="text-xl md:text-2xl font-bold text-foreground inline-flex items-center gap-2 flex-wrap max-w-full">
        <InlineTitleField
          id="store_name"
          label="店舗名"
          value={editing ? form.name : store.name}
          editing={editing}
          onChange={onText("name")}
          required
          error={nameError}
          disabled={pending}
          autoFocus
        />
        <IndividualStoreBadge operatorType={store.operator_type} />
        <ResearchPhaseBadge phase={phase} />
        <Button
          type="button"
          variant="ghost-muted"
          size="sm"
          className={editing ? "invisible" : undefined}
          disabled={editing}
          aria-hidden={editing || undefined}
          tabIndex={editing ? -1 : undefined}
          onClick={() => {
            setForm({ name: store.name, genre: store.genre });
            setNameError(undefined);
            setEditing(true);
          }}
          aria-label="店舗名・業態を編集"
        >
          <Pencil className="h-3.5 w-3.5" />
        </Button>
      </h1>
      {editing && nameError && (
        <p id="store_name_error" className="text-xs text-destructive mt-1" role="alert">
          {nameError}
        </p>
      )}
      <div className="text-base md:text-sm text-muted-foreground mt-0.5 flex items-start flex-wrap gap-x-1">
        {location && <span>{location}</span>}
        {location && (store.genre || editing) && <span aria-hidden="true">/</span>}
        {(store.genre || editing) && (
          <InlineTitleField
            id="store_genre"
            label="業態"
            value={editing ? form.genre : store.genre}
            editing={editing}
            onChange={onText("genre")}
            disabled={pending}
          />
        )}
        {!location && !store.genre && !editing && <span>—</span>}
      </div>
      {editing ? (
        <div className="flex flex-wrap items-center gap-2 mt-2" role="group" aria-label="店舗名・業態の編集操作">
          <Button type="button" variant="primary" onClick={onSave} pending={pending}>
            <Save className="h-3.5 w-3.5" />
            {pending ? "保存中…" : "保存"}
          </Button>
          <Button type="button" variant="ghost" onClick={onCancel} disabled={pending}>
            <X className="h-3.5 w-3.5" /> キャンセル
          </Button>
        </div>
      ) : (
        <>
          {/* 店舗名に営業メモがあるときの案内 (#297)。編集中は保存操作との間に挟まないよう出さない。 */}
          {nameMemo ? (
            <StoreNameMemoNotice
              memo={nameMemo.memo}
              suggestedName={nameMemo.name}
              storeId={store.id}
              onFix={() => {
                // 保存はしない。インライン入力欄へ候補を入れるだけで、確定は人が行う。
                setForm({ name: nameMemo.name, genre: store.genre });
                setNameError(undefined);
                setEditing(true);
              }}
            />
          ) : null}
          <div className="mt-3">
            <NextActionCta phase={phase} storeId={store.id} />
          </div>
        </>
      )}
    </div>
  );
}

/**
 * 店舗名に営業メモが入っているときの案内 (#297)。
 *
 * メモの行き先 (失注理由・再アプローチ / 顧客共有メモ) は内容次第なので自動では
 * 移さない。先に営業記録へ書き写してもらい、店舗名は候補を入れた編集状態で直す。
 */
function StoreNameMemoNotice({
  memo,
  suggestedName,
  storeId,
  onFix,
}: {
  memo: string;
  suggestedName: string;
  storeId: string;
  onFix: () => void;
}) {
  return (
    <div
      role="note"
      aria-label="店舗名に含まれる営業メモ"
      className="mt-3 max-w-2xl rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm"
    >
      <p>
        店舗名に営業メモ「<span className="font-semibold">{memo}</span>」が含まれています。
        検索や AI 調査の屋号照合に混ざるため、
        <Link
          href={`/stores/${storeId}?tab=progress`}
          className="underline underline-offset-2 hover:text-foreground"
        >
          営業進捗
        </Link>
        の営業記録 (失注理由・再アプローチ) か顧客共有メモへ書き写してから、店舗名を直してください。
      </p>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="mt-2"
        onClick={onFix}
      >
        <Pencil className="h-3.5 w-3.5" />
        店舗名を「{suggestedName}」に直す
      </Button>
    </div>
  );
}

/** 表示と入力で同じ文字寸法を使い、長い値の折り返しにも追従する。 */
function InlineTitleField({
  id, label, value, editing, onChange, required, error, disabled, autoFocus,
}: {
  id: string;
  label: string;
  value: string;
  editing: boolean;
  onChange: (event: ChangeEvent<HTMLTextAreaElement>) => void;
  required?: boolean;
  error?: string;
  disabled?: boolean;
  autoFocus?: boolean;
}) {
  return (
    <span className="relative inline-block min-w-[3ch] max-w-full align-top">
      {/* 同じフォントのミラーで寸法を保つ。field-sizing 未対応でも位置が変わらない。 */}
      <span
        aria-hidden={editing || undefined}
        className={`block whitespace-pre-wrap break-words ${editing ? "invisible" : ""}`}
      >
        {value || label}{value.endsWith("\n") ? " " : ""}
      </span>
      {editing && (
        <textarea
          id={id}
          aria-label={label}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}_error` : undefined}
          value={value}
          onChange={onChange}
          required={required}
          disabled={disabled}
          autoFocus={autoFocus}
          rows={1}
          placeholder={label}
          className="absolute inset-0 block h-full w-full resize-none overflow-hidden whitespace-pre-wrap break-words rounded-sm border-0 bg-muted/30 p-0 text-foreground ring-1 ring-input focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 aria-invalid:ring-destructive"
          style={{ font: "inherit", letterSpacing: "inherit" }}
        />
      )}
    </span>
  );
}
