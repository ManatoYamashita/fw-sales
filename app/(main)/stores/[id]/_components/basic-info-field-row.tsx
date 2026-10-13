"use client";

/**
 * 「店舗の調査情報」カードの 1 項目 (#335)
 *
 * 項目名 / 値 / 信頼度 の 3 つを 1 行に並べ、値はその場の入力欄で直接直す。
 * 表示と編集を切り替える「編集」ボタンは持たない。値を変えた項目にだけ
 * 「保存」「取消」を入力欄の直下に出す。
 *
 * - 保存は `updateBasicInfoFieldAction` を `runAction` 経由で呼ぶ (#327)。
 *   Action が `mergeBasicInfo(..., "manual")` で保存し、以後の自動充填から保護する。
 *   手入力の値は確信度・出典を持たないため、信頼度は「未評価」になる。
 * - 保存中は保存ボタンの `pending` (#326) で二重送信を防ぎ、入力欄は読み取り専用にする。
 * - 失敗しても入力した値は残し、入力欄の直下に次の操作を示す。
 * - フォーカスが外れただけでは何もしない (未保存の値を捨てない・勝手に保存しない)。
 *
 * 信頼度の判定は `lib/domain/basic-info-trust.ts`、入力欄の種類やキー操作の判定は
 * `basic-info-field-model.ts` が持つ。
 *
 * 関連: docs/architecture/basic-info-inline-edit.md
 */

import {
  useEffect,
  useId,
  useRef,
  useState,
  useTransition,
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { useRouter } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { runAction } from "@/lib/client/run-action";
import { updateBasicInfoFieldAction } from "@/lib/actions/basic-info-actions";
import type { BasicInfoItemDef } from "@/lib/domain/basic-info-items";
import {
  BASIC_INFO_TRUST_CRITERIA,
  basicInfoTrustLabel,
  classifyBasicInfoTrust,
  hasBasicInfoValue,
  type BasicInfoTrust,
} from "@/lib/domain/basic-info-trust";
import type { BasicInfoField } from "@/types/basic-info";
import {
  TIER_DESCRIPTIONS,
  describeFieldOrigin,
  estimateTextareaRows,
  formatUpdatedAt,
  isDraftDirty,
  readFieldKeyCommand,
  usesSingleLineInput,
} from "./basic-info-field-model";
import { TrustBadge } from "./basic-info-trust-badge";

export interface BasicInfoFieldRowProps {
  storeId: string;
  def: BasicInfoItemDef;
  field: BasicInfoField | undefined;
}

export function BasicInfoFieldRow({ storeId, def, field }: BasicInfoFieldRowProps) {
  const router = useRouter();
  const ids = useId();
  const inputId = `basic-info-${def.key}`;
  const trustId = `${ids}-trust`;
  const hintId = `${ids}-hint`;
  const errorId = `${ids}-error`;
  const inputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const serverValue = field?.value ?? "";
  // 最後に保存できた値。保存直後は画面の再取得より先にこちらを基準にする。
  const [savedValue, setSavedValue] = useState(serverValue);
  const [draft, setDraft] = useState(serverValue);
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();
  // 保存できたら、保存中の表示を終えてから画面を再取得する。
  // 遷移の中で `router.refresh()` を呼ぶと、再取得の遷移が保存の遷移に束ねられ、
  // 再取得が終わるまで「保存中」が消えない (dev では 10 秒近く残った)。
  const refreshAfterSaveRef = useRef(false);
  useEffect(() => {
    if (pending || !refreshAfterSaveRef.current) return;
    refreshAfterSaveRef.current = false;
    router.refresh();
  }, [pending, router]);

  // 再取得や他の人の保存でサーバの値が変わったら追従する。入力中の値は上書きしない。
  const [prevServerValue, setPrevServerValue] = useState(serverValue);
  if (serverValue !== prevServerValue) {
    setPrevServerValue(serverValue);
    setSavedValue(serverValue);
    if (!isDraftDirty(draft, savedValue)) setDraft(serverValue);
  }

  const dirty = isDraftDirty(draft, savedValue);
  const showActions = dirty || pending || failed;
  const multiline = !usesSingleLineInput(def.key, savedValue);

  // 保存した直後 (再取得の前) は、画面上の field がまだ古い値の根拠を持っている。
  // 人が直した値に元の確信度を出さないよう、その間は根拠を持たない値として扱う。
  const metaIsCurrent = savedValue === serverValue;
  const shownField: BasicInfoField | undefined = metaIsCurrent
    ? field
    : savedValue.trim() === ""
      ? undefined
      : { value: savedValue, tier: def.default_tier, filled_by: "manual", updated_at: "" };
  const trust: BasicInfoTrust = classifyBasicInfoTrust(shownField);

  // 保存・取消で操作ボタンが消えてもフォーカスを見失わないよう、入力欄へ戻す。
  const focusInput = () => (inputRef.current ?? textareaRef.current)?.focus();

  const onCancel = () => {
    setDraft(savedValue);
    setFailed(false);
    focusInput();
  };

  const onSave = () => {
    if (pending || !dirty) return;
    const next = draft.trim();
    startTransition(async () => {
      const result = await runAction(
        () => updateBasicInfoFieldAction(storeId, def.key, next),
        { success: "保存しました" },
      );
      if (result?.ok) {
        setSavedValue(next);
        setDraft(next);
        setFailed(false);
        focusInput();
        refreshAfterSaveRef.current = true;
        return;
      }
      // 失敗の理由は runAction のトーストが読み上げる。ここでは入力欄の近くに
      // 値が残っていることと次の操作を示す。
      setFailed(true);
    });
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSave();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const command = readFieldKeyCommand(event.nativeEvent, { multiline, dirty });
    if (command === null) return;
    event.preventDefault();
    if (command === "save") onSave();
    else onCancel();
  };

  const hasBadge = dirty || trust.kind !== "empty";
  const describedBy = [failed ? errorId : null, showActions ? hintId : null, hasBadge ? trustId : null]
    .filter(Boolean)
    .join(" ");
  const placeholder = def.default_tier === "C" ? "未入力（店主へのヒアリングで確認）" : "未入力";
  const sharedInputProps = {
    id: inputId,
    value: draft,
    placeholder,
    readOnly: pending,
    "aria-busy": pending || undefined,
    "aria-invalid": failed || undefined,
    "aria-describedby": describedBy,
    onKeyDown,
    onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      setDraft(event.target.value);
      if (failed) setFailed(false);
    },
  };

  return (
    <li
      className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 gap-y-1.5 py-3 @2xl:grid-cols-[minmax(0,13rem)_minmax(0,1fr)_7rem]"
      data-unsaved={dirty || undefined}
    >
      <label
        htmlFor={inputId}
        className="col-start-1 row-start-1 text-sm font-medium text-foreground break-words @2xl:pt-2"
      >
        {def.label}
      </label>

      <div className="col-start-2 row-start-1 justify-self-end @2xl:col-start-3 @2xl:pt-1.5">
        <TrustBadge id={trustId} trust={dirty ? null : trust} />
      </div>

      <form
        onSubmit={onSubmit}
        className="col-span-2 row-start-2 min-w-0 @2xl:col-span-1 @2xl:col-start-2 @2xl:row-start-1"
      >
        {multiline ? (
          <Textarea
            {...sharedInputProps}
            ref={textareaRef}
            // field-sizing 対応ブラウザでは内容に合わせて伸びる。未対応では行数の目安で開く。
            rows={estimateTextareaRows(draft)}
            className="field-sizing-content min-h-9 max-h-72"
          />
        ) : (
          <Input {...sharedInputProps} ref={inputRef} type="text" />
        )}

        {showActions ? (
          <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
            <Button type="submit" size="sm" pending={pending} disabled={!dirty}>
              {pending ? "保存中" : "保存"}
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={pending}>
              取消
            </Button>
            <span id={hintId} className="text-xs text-muted-foreground">
              {draft.trim() === ""
                ? "空欄のまま保存すると未入力に戻ります。"
                : multiline
                  ? "Ctrl（⌘）+ Enter でも保存できます。"
                  : "Enter でも保存できます。"}
            </span>
          </div>
        ) : null}

        {failed ? (
          <p id={errorId} className="mt-1.5 text-xs text-destructive">
            保存できませんでした。入力した内容は残っています。もう一度「保存」を押してください。
            続けて失敗する場合は、内容を控えてからページを再読み込みしてください。
          </p>
        ) : null}

        <FieldDetails def={def} field={metaIsCurrent ? field : shownField} trust={trust} />
      </form>
    </li>
  );
}

/**
 * 根拠・詳細。通常の一覧では値と信頼度を主役にし、出典・引用・取得区分・由来・
 * 更新日時はここへまとめる。読み取り専用なので、閉じても入力中の値は失われない。
 */
function FieldDetails({
  def,
  field,
  trust,
}: {
  def: BasicInfoItemDef;
  field: BasicInfoField | undefined;
  trust: BasicInfoTrust;
}) {
  const filled = hasBasicInfoValue(field);
  const hearing = field?.hearing_question?.trim();
  if (!filled && !hearing) return null;

  const updatedAt = formatUpdatedAt(field?.updated_at);
  const urls = filled ? (field?.source_urls ?? []) : [];
  const quote = filled ? field?.source_quote?.trim() : undefined;

  return (
    <details className="group/details mt-1.5 text-xs">
      <summary className="inline-flex min-h-11 cursor-pointer items-center gap-1 rounded-sm text-muted-foreground hover:text-foreground md:min-h-6 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <ChevronRight
          aria-hidden
          className="size-3.5 shrink-0 transition-transform group-open/details:rotate-90 motion-reduce:transition-none"
        />
        根拠・詳細
      </summary>
      <dl className="mt-1 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 rounded-md bg-muted px-3 py-2 text-muted-foreground">
        {filled ? (
          <>
            <dt>信頼度</dt>
            <dd className="text-foreground">
              {trust.kind === "rated"
                ? `${basicInfoTrustLabel(trust)}（スコア ${trust.score}。${BASIC_INFO_TRUST_CRITERIA[trust.level]}）`
                : "未評価（AI調査のスコアが無い値です）"}
            </dd>
            <dt>由来</dt>
            <dd className="text-foreground">{describeFieldOrigin(field!)}</dd>
          </>
        ) : null}
        {urls.length > 0 ? (
          <>
            <dt>出典</dt>
            <dd className="space-y-0.5">
              {urls.map((url) => (
                <a
                  key={url}
                  href={url}
                  target="_blank"
                  rel="noreferrer"
                  className="block break-all text-link hover:underline"
                >
                  {url}
                </a>
              ))}
            </dd>
          </>
        ) : null}
        {quote ? (
          <>
            <dt>引用</dt>
            <dd className="whitespace-pre-wrap break-words text-foreground">「{quote}」</dd>
          </>
        ) : null}
        {hearing ? (
          <>
            <dt>ヒアリング</dt>
            <dd className="whitespace-pre-wrap break-words text-foreground">{hearing}</dd>
          </>
        ) : null}
        <dt>取得区分</dt>
        <dd className="text-foreground">{TIER_DESCRIPTIONS[def.default_tier]}</dd>
        {filled && updatedAt ? (
          <>
            <dt>更新</dt>
            <dd className="tabular-nums text-foreground">{updatedAt}</dd>
          </>
        ) : null}
      </dl>
    </details>
  );
}
