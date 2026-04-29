import { type ReactNode, type LabelHTMLAttributes } from "react";
import { cn } from "@/lib/utils/cn";

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
    <label
      htmlFor={htmlFor}
      className={cn("flex flex-col gap-1.5", className)}
      {...props}
    >
      <span className="text-xs font-semibold text-slate-700">
        {label}
        {required ? <span className="ml-1 text-red-600">*</span> : null}
      </span>
      {children}
      {hint && !error ? (
        <span className="text-xs text-slate-500">{hint}</span>
      ) : null}
      {error ? <span className="text-xs text-red-600">{error}</span> : null}
    </label>
  );
}
