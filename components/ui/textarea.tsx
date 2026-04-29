import { type TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/utils/cn";

export type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement>;

export function Textarea({ className, rows = 4, ...props }: TextareaProps) {
  return (
    <textarea
      rows={rows}
      className={cn(
        "w-full px-3 py-2 rounded-md border border-slate-300 bg-white text-sm text-slate-900 leading-6 resize-y",
        "placeholder:text-slate-400",
        "focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20",
        "disabled:bg-slate-50 disabled:text-slate-400 disabled:cursor-not-allowed",
        className,
      )}
      {...props}
    />
  );
}
