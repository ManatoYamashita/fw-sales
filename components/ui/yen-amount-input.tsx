"use client";

import { useLayoutEffect, useRef, useState, type ChangeEvent, type CompositionEvent } from "react";
import { Input } from "@/components/ui/input";
import {
  applyYenAmountInput,
  formatYenDigits,
  type YenAmountInputState,
} from "@/lib/domain/yen-amount";

/**
 * 整数円の金額入力 (#172 sales-activity-ux)。
 *
 * - 入力欄には 3 桁カンマ区切りで表示し、右側に「円」サフィックスを表示する
 * - FormData へは hidden input 経由でカンマなしの整数円 (または空文字) だけを送る
 * - 全角数字・カンマ付き貼り付けを受け付けて正規化する。不正文字は原文を保って拒否する
 * - DB integer 上限を超える入力も原文を保って拒否し、フォーム送信を停止する
 * - 未入力は空欄のまま (勝手に 0 を表示しない)。空欄をどう保存するかはサーバ側の
 *   現行仕様に従う (estimate_amount: 0 / order_amount: null)
 * - 「10万円」のような日本語単位の補助表示は仕様で禁止のため行わない
 */
export function YenAmountInput({
  id,
  name,
  defaultValue,
  disabled,
  "aria-label": ariaLabel,
}: {
  id: string;
  name: string;
  /** 保存済みの整数円。未設定 (新規) は空欄で表示する */
  defaultValue?: number | null;
  disabled?: boolean;
  "aria-label"?: string;
}) {
  const [state, setState] = useState<YenAmountInputState>(() => {
    const canonical = defaultValue === null || defaultValue === undefined ? "" : String(defaultValue);
    return { display: formatYenDigits(canonical), canonical, error: null };
  });
  // IME 変換中は表示テキストを確定させず、compositionend でまとめて正規化する
  const [composingText, setComposingText] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // 「カーソルの左側にある数字の個数」を保存し、カンマ再整形後も同じ数字の直後へ
  // カーソルを戻す (毎入力で末尾へ飛ぶのを防ぐ)
  const pendingCursorDigits = useRef<number | null>(null);

  const display = composingText ?? state.display;
  const unitId = `${id}-unit`;
  const errorId = `${id}-error`;

  const applyText = (text: string, cursor: number | null) => {
    const next = applyYenAmountInput(text);
    if (cursor !== null && next.error === null) {
      const beforeCursor = applyYenAmountInput(text.slice(0, cursor));
      pendingCursorDigits.current = beforeCursor.error === null ? beforeCursor.canonical.length : null;
    } else {
      pendingCursorDigits.current = null;
    }
    setState(next);
  };

  const onChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (composingText !== null) {
      setComposingText(e.target.value);
      return;
    }
    applyText(e.target.value, e.target.selectionStart);
  };

  const onCompositionStart = () => setComposingText(display);
  const onCompositionEnd = (e: CompositionEvent<HTMLInputElement>) => {
    setComposingText(null);
    applyText(e.currentTarget.value, e.currentTarget.selectionStart);
  };

  useLayoutEffect(() => {
    const wanted = pendingCursorDigits.current;
    if (wanted === null || !inputRef.current) return;
    pendingCursorDigits.current = null;
    const formatted = state.display;
    let seen = 0;
    let pos = formatted.length;
    for (let i = 0; i < formatted.length; i++) {
      if (seen === wanted) { pos = i; break; }
      if (/[0-9]/.test(formatted[i]!)) seen++;
    }
    if (seen < wanted) pos = formatted.length;
    inputRef.current.setSelectionRange(pos, pos);
  }, [state]);

  useLayoutEffect(() => {
    inputRef.current?.setCustomValidity(
      composingText !== null ? "入力を確定してから送信してください。" : (state.error ?? ""),
    );
  }, [composingText, state.error]);

  return (
    <div className="relative">
      <Input
        ref={inputRef}
        id={id}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        value={display}
        onChange={onChange}
        onCompositionStart={onCompositionStart}
        onCompositionEnd={onCompositionEnd}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-invalid={state.error ? true : undefined}
        aria-describedby={`${unitId}${state.error ? ` ${errorId}` : ""}`}
        className="pr-9 text-right tabular-nums"
      />
      <span id={unitId} className="pointer-events-none absolute right-3 top-[18px] -translate-y-1/2 text-sm text-muted-foreground">
        円
      </span>
      {state.error ? (
        <p id={errorId} className="mt-1.5 text-xs text-destructive" role="alert">
          {state.error}
        </p>
      ) : null}
      {/* 不正時は古い値を残さず空文字にし、visible input の custom validity で送信を止める。 */}
      <input type="hidden" name={name} value={composingText === null ? state.canonical : ""} />
    </div>
  );
}
