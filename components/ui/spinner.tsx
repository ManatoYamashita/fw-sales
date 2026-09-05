import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils/cn";

type SpinnerProps = {
  className?: string;
  size?: "sm" | "md" | "lg";
  tone?: "muted" | "primary";
};

export function Spinner({
  className,
  size = "md",
  tone = "muted",
}: SpinnerProps) {
  return (
    <Loader2
      className={cn(
        "animate-spin",
        size === "sm" ? "h-3 w-3" : size === "lg" ? "h-5 w-5" : "h-4 w-4",
        tone === "primary" ? "text-primary-foreground" : "text-muted-foreground",
        className,
      )}
      aria-label="読み込み中"
    />
  );
}
