import { Star, StarHalf } from "lucide-react";
import { cn } from "@/lib/utils/cn";

export interface StarRatingProps {
  value: number;
  max?: number;
  className?: string;
  showValue?: boolean;
}

export function StarRating({
  value,
  max = 5,
  className,
  showValue = false,
}: StarRatingProps) {
  const safe = Math.max(0, Math.min(max, value || 0));
  const full = Math.floor(safe);
  const half = safe - full >= 0.5;
  const empty = max - full - (half ? 1 : 0);

  return (
    <span
      className={cn("inline-flex items-center gap-0.5 text-amber-500", className)}
      aria-label={`評価 ${safe.toFixed(1)} / ${max}`}
    >
      {Array.from({ length: full }).map((_, i) => (
        <Star key={`f${i}`} className="h-3.5 w-3.5 fill-current" />
      ))}
      {half ? <StarHalf className="h-3.5 w-3.5 fill-current" /> : null}
      {Array.from({ length: empty }).map((_, i) => (
        <Star key={`e${i}`} className="h-3.5 w-3.5 text-slate-300" />
      ))}
      {showValue ? (
        <span className="ml-1 text-xs font-semibold text-slate-700">
          {safe.toFixed(1)}
        </span>
      ) : null}
    </span>
  );
}
