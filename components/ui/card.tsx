import { type HTMLAttributes } from "react";
import { cn } from "@/lib/utils/cn";

function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "bg-card text-card-foreground border border-border rounded-lg shadow-card overflow-hidden",
        "transition-shadow duration-200",
        className,
      )}
      {...props}
    />
  );
}

function CardHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 px-5 py-4 border-b border-border",
        className,
      )}
      {...props}
    />
  );
}

function CardTitle({
  className,
  ...props
}: HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3
      className={cn(
        "text-base font-semibold leading-none tracking-tight",
        className,
      )}
      {...props}
    />
  );
}

function CardDescription({
  className,
  ...props
}: HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  );
}

type CardBodyProps = HTMLAttributes<HTMLDivElement> & {
  padding?: "default" | "compact" | "flush" | "spacious";
};

function CardBody({ className, padding = "default", ...props }: CardBodyProps) {
  const paddingClass = {
    default: "px-5 py-4",
    compact: "px-5 py-1",
    flush: "p-0",
    spacious: "px-5 py-8",
  }[padding];

  return <div className={cn(paddingClass, className)} {...props} />;
}

function CardFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex items-center justify-end gap-2 px-5 py-3 border-t border-border bg-muted/30",
        className,
      )}
      {...props}
    />
  );
}

const CardCompound = Object.assign(Card, {
  Header: CardHeader,
  Title: CardTitle,
  Description: CardDescription,
  Body: CardBody,
  Footer: CardFooter,
});

export {
  CardCompound as Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardBody,
  CardFooter,
};
