import { type HTMLAttributes } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils/cn";

const badgeVariants = cva(
  "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium leading-5 whitespace-nowrap",
  {
    variants: {
      tone: {
        // 新 semantic 系
        default: "bg-secondary text-secondary-foreground",
        secondary: "bg-secondary text-secondary-foreground",
        info: "bg-info-soft text-info",
        success: "bg-success-soft text-success",
        warning: "bg-warning-soft text-warning",
        destructive: "bg-destructive-soft text-destructive",
        outline: "border border-border text-foreground",
        // 旧色名 (互換): dark mode の見え方も最低限担保
        neutral: "bg-secondary text-secondary-foreground",
        slate: "bg-secondary text-secondary-foreground",
        blue: "bg-info-soft text-info",
        cyan: "bg-cyan-100 text-cyan-700 dark:bg-cyan-950/40 dark:text-cyan-300",
        green: "bg-success-soft text-success",
        amber: "bg-warning-soft text-warning",
        orange:
          "bg-orange-100 text-orange-700 dark:bg-orange-950/40 dark:text-orange-300",
        red: "bg-destructive-soft text-destructive",
        purple:
          "bg-purple-100 text-purple-700 dark:bg-purple-950/40 dark:text-purple-300",
        // 動的トーン: data-stage 属性で配色決定
        stage: "bg-stage text-stage-foreground",
      },
    },
    defaultVariants: {
      tone: "default",
    },
  },
);

export interface BadgeProps
  extends HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {
  /** stage トーン用: globals.css の `[data-stage="..."]` ルールが配色を切替 */
  "data-stage"?: string;
  /** 互換用: 直接配色を inline で指定する場合 (StageBadge 旧API) */
  swatch?: { bg: string; color: string };
}

export function Badge({
  className,
  tone,
  swatch,
  style,
  ...props
}: BadgeProps) {
  const swatchStyle = swatch
    ? { background: swatch.bg, color: swatch.color, ...style }
    : style;
  return (
    <span
      className={cn(
        !swatch && badgeVariants({ tone }),
        swatch &&
          "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium leading-5 whitespace-nowrap",
        className,
      )}
      style={swatchStyle}
      {...props}
    />
  );
}

export { badgeVariants };
