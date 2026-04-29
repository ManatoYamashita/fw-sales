import { type InputHTMLAttributes } from "react";
import { cn } from "@/lib/utils/cn";

export type InputProps = InputHTMLAttributes<HTMLInputElement>;

export function Input({ className, ...props }: InputProps) {
  return (
    <input
      className={cn(
        "h-10 w-full px-3 rounded-md border border-slate-300 bg-white text-sm text-slate-900",
        "placeholder:text-slate-400",
        "focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20",
        "disabled:bg-slate-50 disabled:text-slate-400 disabled:cursor-not-allowed",
        className,
      )}
      {...props}
    />
  );
}
