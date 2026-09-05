import { type ButtonHTMLAttributes } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils/cn";

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
      size: {
        xs: "h-7 px-2 text-xs rounded-md",
        sm: "h-8 px-3 text-sm rounded-md",
        md: "h-9 px-4 text-sm rounded-md",
        lg: "h-10 px-5 text-sm rounded-md",
        xl: "h-11 px-6 text-base rounded-md",
        icon: "h-9 w-9 rounded-md",
        "icon-sm": "h-8 w-8 rounded-md",
        "icon-lg": "h-10 w-10 rounded-md",
        /**
         * タッチ操作向けの 44px (#234)。既定 (`md` = 36px) は据え置き、モバイル主要
         * 導線でだけ使う。既存 variant の値を動かすと 38 ファイル・size 指定 68 箇所に
         * 波及するため、全画面での 44px 化の要否は #225 Phase 1 で別途決める。
         *
         * `size="sm"` に `className="h-11"` を重ねる回避策は採れない。`cn` は素の
         * clsx (tailwind-merge なし) で、同じプロパティを 2 つ並べると CSS の記述順で
         * 勝敗が決まるため (store-quick-filters.tsx の JSDoc が名指しで禁じている)。
         * 正方形のアイコンボタンで `size="sm"` + `p-0` としても、`p-0` が `sm` の
         * `px-3` に負けて左右 padding が残る。`icon` 系 size を使うこと。
         */
        touch: "h-11 px-4 text-sm rounded-md",
        "icon-touch": "h-11 w-11 rounded-md",
      },
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
