"use client";

import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
} from "react";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import {
  VIEWPORT_MARGIN,
  computePanelPlacement,
  findTypeaheadMatch,
  indexOfValue,
  initialValueOf,
  isOutsideViewport,
  isTypeaheadKey,
  resolveActiveIndex,
  resolveOpeningIndex,
  type SelectOption,
} from "./select-logic";

// 候補を組み立てる関数は "use client" の外 (select-logic.ts) から import する。
// ここから re-export すると、Server Component で呼んだときに client reference になる。
export type { SelectOption } from "./select-logic";

export type SelectWidth = "full" | "auto";
/**
 * 高さと字送り。
 *
 * - `default` / `compact`: md 未満では 44px のタッチ領域を確保し、md 以上で各高さに戻る
 *   (`Button` の size と同じ方針)。
 * - `touch`: 幅によらず常に 44px。狭いコンテナでだけ表示する操作帯など、
 *   デスクトップ幅でもタッチ前提の並びに置くときに使う。
 */
export type SelectDensity = "default" | "compact" | "touch";

export interface SelectProps {
  /** 候補。表示順のまま並ぶ。 */
  options: readonly SelectOption[];
  /** Select の幅は利用側で意図を明示する。未指定の基底幅に依存させない。 */
  width: SelectWidth;
  density?: SelectDensity;
  /** 制御モードの値。指定すると内部状態を持たず、この値だけを表示・送信する。 */
  value?: string;
  /** 非制御モードの初期値。フォームのリセットでもこの値へ戻る。 */
  defaultValue?: string;
  /** 利用者が別の候補を選んだときだけ呼ぶ (同じ候補の選び直しでは呼ばない)。 */
  onValueChange?: (value: string) => void;
  /** 値に一致する候補が無いときにトリガーへ出す文言。 */
  placeholder?: string;
  /** トリガー (button) の id。`<label htmlFor>` と関連付ける。 */
  id?: string;
  /** フォーム送信に使う名前。指定すると非表示の入力で値を送る。 */
  name?: string;
  /** フォームの外に置くときに、送信先のフォームの id を指定する。 */
  form?: string;
  required?: boolean;
  disabled?: boolean;
  /** 余白や最小幅など、トリガーの配置に関するクラス。基底のサイズ・色は上書きしない。 */
  className?: string;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean | "true" | "false";
}

const DENSITY_CLASSES: Record<SelectDensity, string> = {
  // 字送りは density で排他にする。基底へ `text-sm` を残して compact 側に
  // `text-xs` を重ねると、`cn` (素の clsx) では勝敗が生成 CSS の順序で決まる。
  default: "h-9 min-h-11 md:min-h-0 text-base sm:text-sm",
  compact: "h-8 min-h-11 md:min-h-0 text-base sm:text-xs",
  touch: "h-11 text-sm",
};

/**
 * トリガーのクラス。コンポーネントと `class-conflicts.test.ts` が同じ resolver を通す
 * (テスト側へ写経すると、軸を足した瞬間に検査が素通りするため)。
 */
export function selectTriggerClasses({
  width,
  density = "default",
}: {
  width: SelectWidth;
  density?: SelectDensity;
}): string {
  return cn(
    "inline-flex max-w-full items-center justify-between gap-2 rounded-md border border-input bg-background px-3 text-left",
    DENSITY_CLASSES[density],
    width === "full" && "w-full",
    "text-foreground shadow-xs transition-[box-shadow,border-color,background-color]",
    "enabled:hover:border-ring/60 aria-expanded:border-ring/60",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:border-ring/60",
    "disabled:cursor-not-allowed disabled:opacity-50 disabled:bg-muted",
    "aria-invalid:border-destructive aria-invalid:ring-destructive/20",
  );
}

/**
 * 候補パネル。Popover API の top layer に載せるので、モーダル・スクロール領域・
 * `overflow: hidden` のカードの中でも切れず、z-index の競合も起きない。
 * Popover API の無いブラウザでは `fixed` + `z-50` の通常描画に劣化する。
 * UA が `[popover]` に当てる中央寄せ (`inset: 0; margin: auto`) は打ち消す。
 */
const PANEL_CLASS =
  "fixed z-50 m-0 inset-auto overflow-y-auto overscroll-contain rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-popover";

const OPTION_CLASS =
  "relative flex min-h-11 md:min-h-8 cursor-default select-none items-center rounded-sm py-1.5 pl-8 pr-3 text-sm data-active:bg-accent data-active:text-accent-foreground aria-selected:font-medium aria-disabled:cursor-not-allowed aria-disabled:opacity-50";

/** 文字入力による候補移動で、連続入力とみなす間隔 (ms)。 */
const TYPEAHEAD_RESET_MS = 500;

/** ラベルの読み上げ対象の文字列。必須マーク (`*`) など aria-hidden の装飾は除く。 */
function readableLabelText(label: HTMLElement): string {
  const clone = label.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('[aria-hidden="true"]').forEach((node) => node.remove());
  return clone.textContent?.trim() ?? "";
}

function supportsPopover(element: HTMLElement): boolean {
  return typeof element.showPopover === "function";
}

/**
 * アプリ共通の Select (#334)。開いた候補をブラウザ / OS 標準のプルダウンにしない。
 *
 * ## 構造
 *
 * WAI-ARIA の select-only combobox パターン。フォーカスは常にトリガー (`button`) に
 * 留まり、強調中の候補は `aria-activedescendant` で伝える。フォーカスが候補へ
 * 移らないので、閉じた後に戻す先を記憶する必要が無く、モーダルのフォーカス
 * トラップとも干渉しない。
 *
 * ## フォーム連携
 *
 * `name` を渡すと非表示の入力で値を送る。可視のコントロールはトリガーだけで、
 * 非表示の入力は Tab 順にも読み上げにも現れない。`required` のときだけ、ブラウザの
 * 入力検証に参加できる視覚的に隠した入力にする (`type="hidden"` は検証の対象外)。
 * 検証エラーでブラウザがその入力へフォーカスしたら、トリガーへ移す。
 *
 * 非制御モードはフォームの `reset` イベント (React の `<form action>` が送信成功後に
 * 行うリセットを含む) で `defaultValue` へ戻る。
 *
 * ## 候補に無い値
 *
 * ネイティブの `<select>` は一致する `<option>` が無いと先頭を表示し、そのまま
 * 送信すると利用者が触っていない値で上書きする。ここでは値をそのまま保持して送り、
 * トリガーには `placeholder` を出す。
 */
export function Select({
  options,
  width,
  density = "default",
  value,
  defaultValue,
  onValueChange,
  placeholder,
  id,
  name,
  form,
  required,
  disabled,
  className,
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledBy,
  "aria-describedby": ariaDescribedBy,
  "aria-invalid": ariaInvalid,
}: SelectProps) {
  const baseId = useId();
  const listboxId = `${baseId}-listbox`;
  const optionId = (index: number) => `${baseId}-option-${index}`;

  const isControlled = value !== undefined;
  const [initialValue] = useState(() => defaultValue ?? initialValueOf(options));
  const [internalValue, setInternalValue] = useState(initialValue);
  const current = isControlled ? value : internalValue;

  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [listLabel, setListLabel] = useState<string | undefined>(undefined);

  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const queryRef = useRef("");
  const queryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const selectedIndex = indexOfValue(options, current);
  const selected = selectedIndex === -1 ? undefined : options[selectedIndex];
  const displayLabel = selected?.label ?? placeholder ?? "未選択";

  // Activity (cacheComponents) で画面が隠れたときに開いたまま残さない。
  useLayoutEffect(() => {
    return () => setOpen(false);
  }, []);

  // 非制御モードはフォームのリセットで初期値へ戻す (ネイティブの select と同じ)。
  useEffect(() => {
    const owner = inputRef.current?.form;
    if (!owner || isControlled) return;
    const onReset = () => setInternalValue(initialValue);
    owner.addEventListener("reset", onReset);
    return () => owner.removeEventListener("reset", onReset);
  }, [isControlled, initialValue]);

  useEffect(() => {
    return () => {
      if (queryTimerRef.current) clearTimeout(queryTimerRef.current);
    };
  }, []);

  // 選択直後の保存中に `disabled` へ切り替える利用側 (調査段階・ロール) で、
  // フォーカスが body へ落ちたままにならないよう、解除時にトリガーへ戻す。
  // 保存中に利用者が別の場所へ移っていれば、そちらを優先して何もしない。
  const restoreFocusRef = useRef(false);
  useLayoutEffect(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    if (disabled) {
      if (document.activeElement === trigger) restoreFocusRef.current = true;
      return;
    }
    if (!restoreFocusRef.current) return;
    restoreFocusRef.current = false;
    const focused = document.activeElement;
    if (focused === null || focused === document.body) trigger.focus();
  }, [disabled]);

  // 開いている間の配置・外側クリック・スクロール追従。
  useLayoutEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    const trigger = triggerRef.current;
    if (!panel || !trigger) return;
    if (supportsPopover(panel) && !panel.matches(":popover-open")) {
      panel.showPopover();
    }

    const place = () => {
      const rect = trigger.getBoundingClientRect();
      const viewport = {
        width: document.documentElement.clientWidth,
        height: document.documentElement.clientHeight,
      };
      if (isOutsideViewport(rect, viewport)) {
        setOpen(false);
        return;
      }
      panel.style.minWidth = `${Math.min(rect.width, viewport.width - VIEWPORT_MARGIN * 2)}px`;
      panel.style.maxWidth = `${viewport.width - VIEWPORT_MARGIN * 2}px`;
      panel.style.maxHeight = "none";
      const placement = computePanelPlacement(
        rect,
        { width: panel.offsetWidth, height: panel.scrollHeight },
        viewport,
      );
      panel.style.top = `${placement.top}px`;
      panel.style.left = `${placement.left}px`;
      panel.style.maxHeight = `${placement.maxHeight}px`;
      panel.dataset.side = placement.side;
    };
    place();

    let frame = 0;
    const schedule = (event: Event) => {
      // パネル自身のスクロールでは位置が変わらない。
      if (event.target === panel) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(place);
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && (trigger.contains(target) || panel.contains(target))) {
        return;
      }
      setOpen(false);
    };
    window.addEventListener("scroll", schedule, { capture: true, passive: true });
    window.addEventListener("resize", schedule);
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule, { capture: true });
      window.removeEventListener("resize", schedule);
      document.removeEventListener("pointerdown", onPointerDown, true);
      if (supportsPopover(panel) && panel.matches(":popover-open")) {
        panel.hidePopover();
      }
    };
  }, [open]);

  // 強調中の候補をパネル内で見える位置へ。scrollIntoView は祖先まで動かしうるので、
  // パネルのスクロール位置だけを直接調整する。
  useEffect(() => {
    if (!open || active < 0) return;
    const panel = panelRef.current;
    const option = panel?.children[active];
    if (!panel || !(option instanceof HTMLElement)) return;
    const top = option.offsetTop;
    const bottom = top + option.offsetHeight;
    if (top < panel.scrollTop) {
      panel.scrollTop = top;
    } else if (bottom > panel.scrollTop + panel.clientHeight) {
      panel.scrollTop = bottom - panel.clientHeight;
    }
  }, [open, active]);

  const openPanel = (key: string, activeIndex?: number) => {
    // 候補パネルの名前は、トリガーと同じラベルから取る。
    const label = triggerRef.current?.labels?.[0];
    const labelText = ariaLabel ?? (label ? readableLabelText(label) : undefined);
    setListLabel(labelText || undefined);
    setActive(activeIndex ?? resolveOpeningIndex(key, options, current));
    setOpen(true);
  };

  const commit = (index: number) => {
    setOpen(false);
    const option = options[index];
    if (!option || option.disabled) return;
    if (option.value === current) return;
    if (!isControlled) setInternalValue(option.value);
    onValueChange?.(option.value);
  };

  const typeahead = (char: string, from: number): number => {
    if (queryTimerRef.current) clearTimeout(queryTimerRef.current);
    queryRef.current += char;
    queryTimerRef.current = setTimeout(() => {
      queryRef.current = "";
    }, TYPEAHEAD_RESET_MS);
    return findTypeaheadMatch(options, queryRef.current, from);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;
    const { key } = event;
    if (!open) {
      if (["ArrowDown", "ArrowUp", "Enter", " ", "Home", "End"].includes(key)) {
        event.preventDefault();
        openPanel(key);
        return;
      }
      if (isTypeaheadKey(key, event)) {
        event.preventDefault();
        const match = typeahead(key, resolveOpeningIndex("", options, current));
        openPanel("", match === -1 ? undefined : match);
      }
      return;
    }

    if (key === "Escape") {
      // 外側のモーダルや絞り込みパネルまで閉じないよう、ここで止める。
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      return;
    }
    if (key === "Tab") {
      // 値は変えずに閉じ、フォーカス移動は既定動作に任せる。
      setOpen(false);
      return;
    }
    if (
      key === "Enter" ||
      (key === " " && queryRef.current === "") ||
      (key === "ArrowUp" && event.altKey)
    ) {
      event.preventDefault();
      commit(active);
      return;
    }
    const next = resolveActiveIndex(key, options, active);
    if (next !== null) {
      event.preventDefault();
      setActive(next);
      return;
    }
    if (isTypeaheadKey(key, event)) {
      event.preventDefault();
      const match = typeahead(key, active);
      if (match !== -1) setActive(match);
    }
  };

  const onTriggerClick = () => {
    if (disabled) return;
    if (open) setOpen(false);
    else openPanel("");
  };

  // 候補パネル上の mousedown でトリガーのフォーカスを失わせない。
  // click の既定動作も止める。<label> の中に置かれたとき、候補のクリックが
  // ラベルの活性化としてトリガーへ転送され、閉じた直後に開き直すのを防ぐ。
  const keepFocus = (event: MouseEvent) => event.preventDefault();

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        id={id}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        aria-activedescendant={open && active >= 0 ? optionId(active) : undefined}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        aria-describedby={ariaDescribedBy}
        aria-invalid={ariaInvalid}
        aria-required={required || undefined}
        disabled={disabled}
        onClick={onTriggerClick}
        onKeyDown={onKeyDown}
        onBlur={() => setOpen(false)}
        className={cn(selectTriggerClasses({ width, density }), className)}
      >
        {width === "auto" ? (
          // 幅を候補の最長ラベルに合わせ、選び直しで幅が揺れないようにする
          // (ネイティブの select と同じ)。寸法取りの候補は疑似要素の生成内容で描き、
          // テキストノードを持たせない。テキストで置くとトリガーの textContent が
          // 全候補の連結になり、表示中の値として読み取れなくなる。
          <span className="grid min-w-0 flex-1">
            {[...options.map((option) => option.label), placeholder ?? "未選択"].map(
              (label, index) => (
                <span
                  key={index}
                  aria-hidden
                  data-label={label}
                  className="invisible col-start-1 row-start-1 truncate before:content-[attr(data-label)]"
                />
              ),
            )}
            <span
              className={cn(
                "col-start-1 row-start-1 truncate",
                !selected && "text-muted-foreground",
              )}
            >
              {displayLabel}
            </span>
          </span>
        ) : (
          <span
            className={cn(
              "min-w-0 flex-1 truncate",
              !selected && "text-muted-foreground",
            )}
          >
            {displayLabel}
          </span>
        )}
        <ChevronDown aria-hidden className="size-4 shrink-0 text-muted-foreground" />
      </button>

      {required ? (
        <input
          ref={inputRef}
          name={name}
          form={form}
          value={current}
          required
          disabled={disabled}
          tabIndex={-1}
          aria-hidden
          className="sr-only"
          onChange={() => {}}
          onFocus={() => triggerRef.current?.focus()}
        />
      ) : (
        <input
          ref={inputRef}
          type="hidden"
          name={name}
          form={form}
          value={current}
          disabled={disabled}
        />
      )}

      {open ? (
        <div
          ref={panelRef}
          id={listboxId}
          role="listbox"
          popover="manual"
          aria-label={ariaLabelledBy ? undefined : listLabel}
          aria-labelledby={ariaLabelledBy}
          className={PANEL_CLASS}
          onMouseDown={keepFocus}
          onClick={keepFocus}
        >
          {options.map((option, index) => {
            const isSelected = index === selectedIndex;
            return (
              <div
                key={option.value}
                id={optionId(index)}
                role="option"
                aria-selected={isSelected}
                aria-disabled={option.disabled || undefined}
                data-active={index === active || undefined}
                className={OPTION_CLASS}
                onPointerMove={() => {
                  if (!option.disabled && index !== active) setActive(index);
                }}
                onClick={() => {
                  // 選べない候補を押してもパネルは開いたままにする。
                  if (!option.disabled) commit(index);
                }}
              >
                {isSelected ? (
                  <Check aria-hidden className="absolute left-2 size-4" />
                ) : null}
                <span className="min-w-0 break-words">{option.label}</span>
              </div>
            );
          })}
        </div>
      ) : null}
    </>
  );
}
