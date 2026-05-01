import { type SelectHTMLAttributes } from "react";
import { cn } from "@/lib/utils/cn";

export type SelectProps = SelectHTMLAttributes<HTMLSelectElement>;

const CHEVRON_DATA_URL =
  "data:image/svg+xml;base64,PHN2ZyB4bWxucz0naHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmcnIHdpZHRoPScxMicgaGVpZ2h0PScxMicgdmlld0JveD0nMCAwIDI0IDI0JyBmaWxsPSdub25lJyBzdHJva2U9J2N1cnJlbnRDb2xvcicgc3Ryb2tlLXdpZHRoPScyJyBzdHJva2UtbGluZWNhcD0ncm91bmQnIHN0cm9rZS1saW5lam9pbj0ncm91bmQnPjxwb2x5bGluZSBwb2ludHM9IjYgOSAxMiAxNSAxOCA5Ij48L3BvbHlsaW5lPjwvc3ZnPg==";

export function Select({ className, children, ...props }: SelectProps) {
  return (
    <select
      className={cn(
        "flex h-9 w-full appearance-none rounded-md border border-input bg-background px-3 pr-8 text-sm",
        "text-foreground shadow-xs transition-[box-shadow,border-color,background-color]",
        "bg-no-repeat bg-[right_0.6rem_center] [background-size:12px_12px]",
        "text-muted-foreground/70",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:border-ring/60",
        "disabled:cursor-not-allowed disabled:opacity-50 disabled:bg-muted",
        "[&>option]:text-foreground",
        className,
      )}
      style={{
        backgroundImage: `url(${CHEVRON_DATA_URL})`,
      }}
      {...props}
    >
      {children}
    </select>
  );
}
