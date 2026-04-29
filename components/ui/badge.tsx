import { type HTMLAttributes } from "react";
import { cn } from "@/lib/utils/cn";

type Tone =
  | "neutral"
  | "blue"
  | "green"
  | "amber"
  | "red"
  | "purple"
  | "cyan"
  | "orange"
  | "slate";

const toneClass: Record<Tone, string> = {
  neutral: "bg-slate-100 text-slate-700",
  blue: "bg-blue-100 text-blue-700",
  green: "bg-green-100 text-green-700",
  amber: "bg-amber-100 text-amber-800",
  red: "bg-red-100 text-red-700",
  purple: "bg-purple-100 text-purple-700",
  cyan: "bg-cyan-100 text-cyan-700",
  orange: "bg-orange-100 text-orange-700",
  slate: "bg-slate-200 text-slate-800",
};

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: Tone;
  /** 背景色を直接指定する場合はインラインスタイルで(STAGES の配色を使うため) */
  swatch?: { bg: string; color: string };
}

export function Badge({
  className,
  tone = "neutral",
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
        "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium leading-5 whitespace-nowrap",
        !swatch && toneClass[tone],
        className,
      )}
      style={swatchStyle}
      {...props}
    />
  );
}
