"use client";

import { useLayoutEffect, useRef, useState, type ChangeEvent, type CompositionEvent } from "react";
import { Input } from "@/components/ui/input";
import { extractYenDigits, formatYenDigits, MAX_YEN_AMOUNT } from "@/lib/domain/yen-amount";

/**
 * 整数円の金額入力 (#172 sales-activity-ux)。
 *
 * - 入力欄には 3 桁カンマ区切りで表示し、右側に「円」サフィックスを表示する
 * - FormData へは hidden input 経由でカンマなしの整数円 (または空文字) だけを送る
 * - 全角数字・カンマ付き貼り付けを受け付けて正規化する。英字等の不正文字は除外する
 * - `MAX_YEN_AMOUNT` (DB integer 上限) を超える入力は受け付けず、直前の値を維持する
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
  const [digits, setDigits] = useState(() =>
    defaultValue === null || defaultValue === undefined ? "" : String(defaultValue),
  );
  // IME 変換中は表示テキストを確定させず、compositionend でまとめて正規化する
  const [composingText, setComposingText] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // 「カーソルの左側にある数字の個数」を保存し、カンマ再整形後も同じ数字の直後へ
  // カーソルを戻す (毎入力で末尾へ飛ぶのを防ぐ)
  const pendingCursorDigits = useRef<number | null>(null);

  const display = composingText ?? formatYenDigits(digits);

  const applyText = (text: string, cursor: number | null) => {
    const nextDigits = extractYenDigits(text);
    if (nextDigits.length > String(MAX_YEN_AMOUNT).length || (nextDigits !== "" && Number(nextDigits) > MAX_YEN_AMOUNT)) {
      // 上限超過は受け付けない (直前の値を維持)
      pendingCursorDigits.current = null;
      return;
    }
    if (cursor !== null) {
      pendingCursorDigits.current = extractYenDigits(text.slice(0, cursor)).length;
    }
    setDigits(nextDigits);
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
    const formatted = formatYenDigits(digits);
    let seen = 0;
    let pos = formatted.length;
    for (let i = 0; i < formatted.length; i++) {
      if (seen === wanted) { pos = i; break; }
      if (/[0-9]/.test(formatted[i]!)) seen++;
    }
    if (seen < wanted) pos = formatted.length;
    inputRef.current.setSelectionRange(pos, pos);
  }, [digits]);

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
        className="pr-9 text-right tabular-nums"
      />
      {/* サフィックス。aria-hidden にせず DOM 順で input の直後に置くことで、
          スクリーンリーダーにも単位が「円」であることが伝わる */}
      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
        円
      </span>
      {/* 送信値: カンマなしの整数円 (未入力は空文字)。表示用 input は name を持たない */}
      <input type="hidden" name={name} value={digits} />
    </div>
  );
}
