import { type ReactNode, type LabelHTMLAttributes } from "react";
import { cn } from "@/lib/utils/cn";
import { Label } from "./label";

export interface FormFieldProps extends LabelHTMLAttributes<HTMLLabelElement> {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  children: ReactNode;
}

export function FormField({
  label,
  hint,
  error,
  required,
  className,
  children,
  htmlFor,
  ...props
}: FormFieldProps) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <Label htmlFor={htmlFor} required={required} {...props}>
        {label}
      </Label>
      {children}
      {hint && !error ? (
        <span className="text-xs text-muted-foreground">{hint}</span>
      ) : null}
      {error ? (
        <span className="text-xs text-destructive" role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}
