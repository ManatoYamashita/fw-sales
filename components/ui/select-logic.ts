/**
 * 共通 Select (#334) の判定ロジック。
 *
 * DOM に触れない純粋関数だけを置く。このリポジトリには React component の
 * テスト環境が無いため (`tabs-keyboard.test.ts` と同じ事情)、キー操作の移動先・
 * 文字入力による候補移動・パネルの配置を関数へ切り出し、全分岐をユニットテストで突く。
 * DOM への配線 (フォーカス・ポップオーバー・送信) は `select.tsx` と E2E が受け持つ。
 */

export interface SelectOption {
  /** 送信値。FormData へはこの文字列がそのまま入る。 */
  value: string;
  /** 表示ラベル。トリガーと候補の両方に出る。 */
  label: string;
  /** 選べない候補。表示はするが移動・選択の対象から外す。 */
  disabled?: boolean;
}

/** 値に一致する候補の位置。無ければ -1。 */
export function indexOfValue(
  options: readonly SelectOption[],
  value: string,
): number {
  return options.findIndex((option) => option.value === value);
}

/**
 * 値を指定しないときの初期値。
 *
 * ネイティブの `<select>` は、選択状態の `<option>` が無ければ先頭の有効な候補を
 * 選んだ状態で始まり、その値を送信する。置き換えで送信値が変わらないよう同じ規則にする。
 */
export function initialValueOf(options: readonly SelectOption[]): string {
  return options.find((option) => !option.disabled)?.value ?? "";
}

function firstEnabled(options: readonly SelectOption[]): number {
  return options.findIndex((option) => !option.disabled);
}

function lastEnabled(options: readonly SelectOption[]): number {
  for (let i = options.length - 1; i >= 0; i -= 1) {
    if (!options[i]?.disabled) return i;
  }
  return -1;
}

/** `from` から `step` 方向へ進み、最初に見つかった有効な候補。端で止まる。 */
function stepEnabled(
  options: readonly SelectOption[],
  from: number,
  step: 1 | -1,
  distance = 1,
): number {
  let found = from;
  let moved = 0;
  for (
    let i = from + step;
    i >= 0 && i < options.length && moved < distance;
    i += step
  ) {
    if (options[i]?.disabled) continue;
    found = i;
    moved += 1;
  }
  return found;
}

/** ページ単位の移動量。候補パネルに一度に見える件数の目安。 */
export const PAGE_STEP = 10;

/**
 * 開いているパネルで、強調中の候補をキー入力でどこへ動かすか。
 *
 * 移動に関係ないキーは `null` を返す。ここで値を返すと呼び出し側が `preventDefault`
 * するので、Tab などの既定動作を奪わないよう対象のキーだけに限る。
 * 端では回り込まない (ネイティブの `<select>` と同じ)。
 */
export function resolveActiveIndex(
  key: string,
  options: readonly SelectOption[],
  active: number,
): number | null {
  const first = firstEnabled(options);
  if (first === -1) return null;
  const current = active >= 0 && active < options.length ? active : -1;
  switch (key) {
    case "ArrowDown":
      return current === -1 ? first : stepEnabled(options, current, 1);
    case "ArrowUp":
      return current === -1 ? lastEnabled(options) : stepEnabled(options, current, -1);
    case "Home":
      return first;
    case "End":
      return lastEnabled(options);
    case "PageDown":
      return current === -1 ? first : stepEnabled(options, current, 1, PAGE_STEP);
    case "PageUp":
      return current === -1 ? first : stepEnabled(options, current, -1, PAGE_STEP);
    default:
      return null;
  }
}

/**
 * パネルを開いたときに強調する候補。
 *
 * 選択中の候補があればそこから始める。Home / End で開いたときは端へ、
 * それ以外 (候補にない値・空値) は先頭の有効な候補から始める。
 */
export function resolveOpeningIndex(
  key: string,
  options: readonly SelectOption[],
  value: string,
): number {
  if (key === "Home") return firstEnabled(options);
  if (key === "End") return lastEnabled(options);
  const selected = indexOfValue(options, value);
  if (selected !== -1 && !options[selected]?.disabled) return selected;
  return firstEnabled(options);
}

/** 文字入力による候補移動で、1 文字として扱うキーか。 */
export function isTypeaheadKey(
  key: string,
  modifiers: { ctrlKey: boolean; metaKey: boolean; altKey: boolean },
): boolean {
  if (modifiers.ctrlKey || modifiers.metaKey || modifiers.altKey) return false;
  return [...key].length === 1;
}

/** 大文字小文字・全角半角の違いで一致を逃さないための正規化。 */
function normalizeForMatch(text: string): string {
  return text.normalize("NFKC").toLocaleLowerCase("ja");
}

/**
 * 入力した文字列で始まる候補を探す。
 *
 * - 同じ 1 文字を繰り返し押したときは、その文字で始まる候補を順に巡る
 *   (ネイティブの `<select>` と同じ。`a` `a` `a` で a 始まりの 3 件を巡回する)。
 * - それ以外は、現在の候補を含めた位置から前方へ探し、末尾で先頭へ回り込む。
 *   入力を続けて絞り込む間に強調が他へ飛ばないよう、現在位置を候補に含める。
 */
export function findTypeaheadMatch(
  options: readonly SelectOption[],
  query: string,
  active: number,
): number {
  if (query === "" || options.length === 0) return -1;
  const normalized = normalizeForMatch(query);
  const chars = [...normalized];
  const repeated = chars.every((char) => char === chars[0]);
  const needle = repeated ? (chars[0] ?? "") : normalized;
  // 同じ文字の繰り返しは次の候補から、絞り込み中は現在の候補から探す。
  // 強調中の候補が無ければ先頭から探す。
  const begin = active < 0 ? 0 : active + (repeated ? 1 : 0);
  for (let i = 0; i < options.length; i += 1) {
    const index = (begin + i) % options.length;
    const option = options[index];
    if (!option || option.disabled) continue;
    if (normalizeForMatch(option.label).startsWith(needle)) return index;
  }
  return -1;
}

export interface Rect {
  top: number;
  bottom: number;
  left: number;
  width: number;
}

export interface PanelPlacement {
  top: number;
  left: number;
  maxHeight: number;
  side: "bottom" | "top";
}

/** パネルとトリガーの間隔 (px)。 */
export const PANEL_GAP = 4;
/** パネルと画面端の最小距離 (px)。 */
export const VIEWPORT_MARGIN = 8;
/** パネルの高さの上限 (px)。これを超える候補はパネル内でスクロールする。 */
export const PANEL_MAX_HEIGHT = 320;

/**
 * 候補パネルの位置を決める。
 *
 * - 既定はトリガーの下。下に収まらず、上の方が広いときだけ上へ開く。
 * - 高さは上限と、開く側の空きのうち小さい方。超えた分はパネル内でスクロールする。
 * - 横はトリガーの左端に揃え、画面からはみ出す分だけ内側へ寄せる。
 *
 * `panel` は上限を掛ける前の自然な大きさ (幅は描画後の実測、高さは内容の全高)。
 */
export function computePanelPlacement(
  trigger: Rect,
  panel: { width: number; height: number },
  viewport: { width: number; height: number },
): PanelPlacement {
  const spaceBelow = viewport.height - trigger.bottom - PANEL_GAP - VIEWPORT_MARGIN;
  const spaceAbove = trigger.top - PANEL_GAP - VIEWPORT_MARGIN;
  const wanted = Math.min(panel.height, PANEL_MAX_HEIGHT);
  const side: PanelPlacement["side"] =
    spaceBelow >= wanted || spaceBelow >= spaceAbove ? "bottom" : "top";
  const maxHeight = Math.max(
    0,
    Math.min(PANEL_MAX_HEIGHT, side === "bottom" ? spaceBelow : spaceAbove),
  );
  const height = Math.min(wanted, maxHeight);
  const top =
    side === "bottom" ? trigger.bottom + PANEL_GAP : trigger.top - PANEL_GAP - height;

  const maxLeft = viewport.width - VIEWPORT_MARGIN - panel.width;
  const left = Math.max(VIEWPORT_MARGIN, Math.min(trigger.left, maxLeft));

  return { top, left, maxHeight, side };
}

/** トリガーが画面から完全に外れたか。外れたらパネルを閉じる。 */
export function isOutsideViewport(
  trigger: Rect,
  viewport: { width: number; height: number },
): boolean {
  return (
    trigger.bottom <= 0 ||
    trigger.top >= viewport.height ||
    trigger.left + trigger.width <= 0 ||
    trigger.left >= viewport.width
  );
}

/**
 * 値の配列から候補を作る。ラベルを省くと値をそのまま表示する
 * (`<option>{v}</option>` と同じ。enum の値が日本語の表示名を兼ねている箇所向け)。
 */
export function optionsFromValues<T extends string>(
  values: readonly T[],
  labelOf: (value: T) => string = (value) => value,
): SelectOption[] {
  return values.map((value) => ({ value, label: labelOf(value) }));
}
