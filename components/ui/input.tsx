import { type InputHTMLAttributes, type Ref } from "react";
import { cn } from "@/lib/utils/cn";

// React 19 では関数コンポーネントへ ref を通常の prop として渡せる
// (yen-amount-input のカーソル位置制御で使用)
export type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  ref?: Ref<HTMLInputElement>;
};

export function Input({ className, ...props }: InputProps) {
  return (
    <input
      className={cn(
        "flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm",
        "text-foreground placeholder:text-muted-foreground",
        "shadow-xs transition-[box-shadow,border-color,background-color]",
        "file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:border-ring/60",
        "disabled:cursor-not-allowed disabled:opacity-50 disabled:bg-muted",
        "aria-invalid:border-destructive aria-invalid:ring-destructive/20",
        className,
      )}
      {...props}
    />
  );
}
