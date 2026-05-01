import { type ElementType, type HTMLAttributes } from "react";
import { cn } from "@/lib/utils/cn";

type HeadingLevel = 1 | 2 | 3 | 4;

const HEADING_STYLES: Record<HeadingLevel, string> = {
  1: "text-2xl font-semibold tracking-tight leading-tight",
  2: "text-xl font-semibold tracking-tight leading-snug",
  3: "text-lg font-semibold leading-snug",
  4: "text-base font-semibold leading-snug",
};

interface HeadingProps extends HTMLAttributes<HTMLHeadingElement> {
  level?: HeadingLevel;
  as?: ElementType;
}

export function Heading({
  level = 1,
  as,
  className,
  ...rest
}: HeadingProps) {
  const Tag = (as ?? `h${level}`) as ElementType;
  return (
    <Tag className={cn(HEADING_STYLES[level], className)} {...rest} />
  );
}

export function Display({
  className,
  as: Tag = "h1",
  ...rest
}: HTMLAttributes<HTMLHeadingElement> & { as?: ElementType }) {
  const Component = Tag as ElementType;
  return (
    <Component
      className={cn(
        "text-3xl font-semibold tracking-tight leading-[1.15]",
        className,
      )}
      {...rest}
    />
  );
}

type TextVariant =
  | "body-lg"
  | "body"
  | "body-sm"
  | "label"
  | "muted"
  | "mono";

const TEXT_STYLES: Record<TextVariant, string> = {
  "body-lg": "text-base leading-relaxed",
  body: "text-sm leading-relaxed",
  "body-sm": "text-xs leading-relaxed",
  label: "text-xs font-medium uppercase tracking-wide text-muted-foreground",
  muted: "text-sm text-muted-foreground",
  mono: "font-mono tabular-nums text-sm",
};

interface TextProps extends HTMLAttributes<HTMLParagraphElement> {
  variant?: TextVariant;
  as?: ElementType;
}

export function Text({
  variant = "body",
  as: Tag = "p",
  className,
  ...rest
}: TextProps) {
  const Component = Tag as ElementType;
  return (
    <Component
      className={cn(TEXT_STYLES[variant], className)}
      {...rest}
    />
  );
}
