import { type InputHTMLAttributes, type Ref } from "react";
import { cn } from "@/lib/utils/cn";

// React 19 では関数コンポーネントへ ref を通常の prop として渡せる
// (yen-amount-input のカーソル位置制御で使用)
export type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  ref?: Ref<HTMLInputElement>;
};

/** md 未満はボタンと同じ 44px 下限。高さ自体は変更せず、md で下限を解除する (#257)。 */
export const INPUT_SIZE_CLASSES = {
  default: "h-9 min-h-11 md:min-h-0",
} as const;

export function Input({ className, ...props }: InputProps) {
  return (
    <input
      className={cn(
        INPUT_SIZE_CLASSES.default,
        "flex w-full rounded-md border border-input bg-background px-3 py-1 text-base sm:text-sm",
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
