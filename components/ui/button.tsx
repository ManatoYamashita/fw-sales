import { type ButtonHTMLAttributes } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils/cn";

/**
 * size ごとのクラス。**モバイル (md 未満) では 44px を下限にする** (#225 Phase 1)。
 *
 * ## なぜ `h-*` ではなく `min-h-*` を動かすのか
 *
 * `cn` は素の clsx で tailwind-merge を持たないため、同じプロパティのクラスを 2 つ
 * 並べると勝敗が生成 CSS の記述順で決まる (`docs/architecture/responsive.md` §4.3)。
 * `h-11 md:h-9` のように高さそのものを差し替えると、`variant: link` が持つ `h-auto` や
 * 消費者が `className` で足した `h-*` と順序を争うことになる。
 * **`min-height` は別プロパティなので、どの `h-*` とも争わない。**
 *
 * `xl` (`h-11`) と `touch` / `icon-touch` は元から 44px なので下限を足さない。
 * アイコン系は正方形を保つため `min-w` も併せて広げる。
 *
 * ## 44px の根拠と適用範囲
 *
 * WCAG 2.2 SC 2.5.8 (AA) の 24x24 は既定の 36px で既に満たしている。ここで 44px へ
 * 上げるのは SC 2.5.5 (AAA) と、営業が外回りでスマホから操作する運用を踏まえた判断
 * (#225 Phase 1 で決定)。デスクトップは指ではなくポインタで操作するため据え置く。
 *
 * ## 既存 variant の値そのものは変えていない
 *
 * `h-8` / `h-9` / `h-10` はいずれも据え置きで、md 未満に下限を重ねただけ。デスクトップの
 * 見た目は完全に不変で、回帰面はモバイルに閉じている。**新しい size を足すときは
 * ここへ 44px の下限も足すこと** (`button-touch-target.test.ts` が全 size を走査して強制する)。
 *
 * `xs` (28px) は #250 で追加。`size="sm"` に `className="h-7 px-2 text-xs"` を重ねる
 * 書き方が記述順勝負になっていた箇所 (progress-filter-bar の「すべて解除」) を
 * variant 側へ寄せるためのもの。デスクトップだけ 28px で、モバイルは他と同じ 44px。
 */
export const BUTTON_SIZE_CLASSES = {
  xs: "h-7 min-h-11 md:min-h-0 px-2 text-xs rounded-md",
  sm: "h-8 min-h-11 md:min-h-0 px-3 text-sm rounded-md",
  md: "h-9 min-h-11 md:min-h-0 px-4 text-sm rounded-md",
  lg: "h-10 min-h-11 md:min-h-0 px-5 text-sm rounded-md",
  xl: "h-11 px-6 text-base rounded-md",
  icon: "h-9 w-9 min-h-11 min-w-11 md:min-h-0 md:min-w-0 rounded-md",
  "icon-sm": "h-8 w-8 min-h-11 min-w-11 md:min-h-0 md:min-w-0 rounded-md",
  "icon-lg": "h-10 w-10 min-h-11 min-w-11 md:min-h-0 md:min-w-0 rounded-md",
  /**
   * どの幅でも 44px を保つ明示指定 (#234)。モバイルは上の下限で自動的に 44px に
   * なるので、これを選ぶ意味は「デスクトップでも 44px にしたい」場合に限られる。
   *
   * `size="sm"` に `className="h-11"` を重ねる回避策は採れない。`cn` は素の clsx
   * (tailwind-merge なし) で、同じプロパティを 2 つ並べると CSS の記述順で勝敗が
   * 決まるため (store-quick-filters.tsx の JSDoc が名指しで禁じている)。
   * 正方形のアイコンボタンで `size="sm"` + `p-0` としても、`p-0` が `sm` の `px-3` に
   * 負けて左右 padding が残る。`icon` 系 size を使うこと。
   */
  touch: "h-11 px-4 text-sm rounded-md",
  "icon-touch": "h-11 w-11 rounded-md",
} as const;

/**
 * variant ごとのクラス。色・境界・影だけを持ち、寸法は `BUTTON_SIZE_CLASSES` が持つ。
 *
 * `class-conflicts.test.ts` がこの表を直接読んで「利用側 `className` が基底と同じ CSS
 * プロパティを設定していないか」を検査する。variant を足したら検査対象も自動で増える。
 */
export const BUTTON_VARIANT_CLASSES = {
  default:
    "bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm",
  primary:
    "bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm",
  secondary:
    "bg-secondary text-secondary-foreground hover:bg-secondary/80",
  ghost:
    "bg-transparent text-foreground hover:bg-accent hover:text-accent-foreground",
  "ghost-muted":
    "bg-transparent text-muted-foreground hover:bg-accent hover:text-foreground",
  "ghost-destructive":
    "bg-transparent text-destructive hover:bg-destructive/10 hover:text-destructive",
  outline:
    "border border-input bg-background text-foreground hover:bg-accent hover:text-accent-foreground shadow-xs",
  link: "bg-transparent text-foreground underline-offset-4 hover:underline",
  destructive:
    "bg-destructive text-destructive-foreground hover:bg-destructive/90 shadow-sm",
  "destructive-outline":
    "border border-destructive/40 bg-background text-destructive hover:bg-destructive/10",
  success:
    "bg-success text-success-foreground hover:bg-success/90 shadow-sm",
  danger:
    "bg-destructive text-destructive-foreground hover:bg-destructive/90 shadow-sm",
} as const;

/**
 * アイコンとラベルの間隔。既定は 8px。
 *
 * `className="gap-1.5"` で詰める書き方は成立しない。`cn` は素の clsx なので基底の
 * `gap-2` と両方が出力され、生成 CSS では `.gap-1.5` (4984) より `.gap-2` (5039) が
 * 後に来て勝つ。7 箇所でその指定が一度も描画されていなかった (#250 レビュー)。
 * 間隔を詰めたいときは `className` ではなくこの軸を使う。
 *
 * 基底から `gap-2` を外してここへ移したのは、基底に残したままだと `tight` を選んでも
 * `gap-2` と争って同じ事故になるため。**基底とこの表で同じプロパティを二重に持たせない。**
 * `class-conflicts.test.ts` の自己衝突検査がこれを固定する。
 */
export const BUTTON_GAP_CLASSES = {
  default: "gap-2",
  tight: "gap-1.5",
} as const;

const buttonVariants = cva(
  cn(
    "inline-flex items-center justify-center font-medium whitespace-nowrap",
    "transition-[background-color,color,border-color,box-shadow,transform] duration-150",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
    "disabled:cursor-not-allowed disabled:opacity-50",
    "active:translate-y-px",
  ),
  {
    variants: {
      variant: BUTTON_VARIANT_CLASSES,
      size: BUTTON_SIZE_CLASSES,
      gap: BUTTON_GAP_CLASSES,
    },
    defaultVariants: {
      variant: "default",
      size: "md",
      gap: "default",
    },
  },
);

export type ButtonVariantProps = VariantProps<typeof buttonVariants>;

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    ButtonVariantProps {}

/**
 * 箱を持たない variant。size の寸法を**一切適用しない**。
 *
 * `link` はテキストとして描くための variant なので、`px-*` や `min-h-*` を持つと意味が
 * 壊れる。以前は variant 側へ `px-0 h-auto` を書いて打ち消していたが、`cn` は素の clsx
 * なので `px-0` は size の `px-*` に負けており (実測 `.px-0` 5089 < `.px-4` 5149)、
 * **打ち消しは半分しか成立していなかった** (`h-auto` は逆に勝つ)。
 * 打ち消しではなく**そもそも適用しない**形へ変えたので、記述順に依存しなくなった。
 */
const BOXLESS_VARIANTS: ReadonlySet<string> = new Set(["link"]);

/**
 * その props から実際に出るクラス。**`Button` も検査もこの 1 つを通す。**
 *
 * `buttonVariants()` を直接呼ぶと、component 側の解決 (boxless の除外、`gap` の受け渡し)
 * が抜けた別物を見ることになる。実際 `gap` 軸を足した直後、component が `gap` を
 * `buttonVariants()` へ渡しておらず、検査だけが `gap-1.5` を見ている状態になっていた。
 * `button-wiring.test.tsx` が「描画結果 == この関数の出力」を固定する。
 */
export function buttonClasses({ variant, size, gap }: ButtonVariantProps): string {
  const boxless = variant != null && BOXLESS_VARIANTS.has(variant);
  // cva は `null` を渡すとその軸を defaultVariants ごと飛ばす。
  return buttonVariants({ variant, size: boxless ? null : size, gap });
}

export function Button({
  className,
  variant,
  size,
  gap,
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(buttonClasses({ variant, size, gap }), className)}
      {...props}
    />
  );
}

export { buttonVariants };
