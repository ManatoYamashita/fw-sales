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

const buttonVariants = cva(
  cn(
    "inline-flex items-center justify-center gap-2 font-medium whitespace-nowrap",
    "transition-[background-color,color,border-color,box-shadow,transform] duration-150",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
    "disabled:cursor-not-allowed disabled:opacity-50",
    "active:translate-y-px",
  ),
  {
    variants: {
      variant: {
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
        link: "bg-transparent text-foreground underline-offset-4 hover:underline px-0 h-auto",
        destructive:
          "bg-destructive text-destructive-foreground hover:bg-destructive/90 shadow-sm",
        "destructive-outline":
          "border border-destructive/40 bg-background text-destructive hover:bg-destructive/10",
        success:
          "bg-success text-success-foreground hover:bg-success/90 shadow-sm",
        danger:
          "bg-destructive text-destructive-foreground hover:bg-destructive/90 shadow-sm",
      },
      size: BUTTON_SIZE_CLASSES,
    },
    defaultVariants: {
      variant: "default",
      size: "md",
    },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export function Button({
  className,
  variant,
  size,
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
}

export { buttonVariants };
