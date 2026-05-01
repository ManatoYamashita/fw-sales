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
        // 旧色名 (互換): 色数最小化の方針で全て neutral 系に統一
        neutral: "bg-secondary text-secondary-foreground",
        slate: "bg-secondary text-secondary-foreground",
        blue: "bg-secondary text-secondary-foreground",
        cyan: "bg-secondary text-secondary-foreground",
        green: "bg-success-soft text-success",
        amber: "bg-secondary text-secondary-foreground",
        orange: "bg-secondary text-secondary-foreground",
        red: "bg-destructive-soft text-destructive",
        purple: "bg-secondary text-secondary-foreground",
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
