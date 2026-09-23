import {
  Children,
  cloneElement,
  isValidElement,
  useId,
  type LabelHTMLAttributes,
  type ReactElement,
  type ReactNode,
} from "react";
import { cn } from "@/lib/utils/cn";
import { Label } from "./label";

type FieldControlProps = {
  "aria-describedby"?: string;
  "aria-invalid"?: boolean | "false" | "true";
  required?: boolean;
};

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
  const fieldId = useId();
  const hintId = hint ? `${fieldId}-hint` : undefined;
  const errorId = error ? `${fieldId}-error` : undefined;
  const describedBy = errorId ?? hintId;

  const childArray = Children.toArray(children);
  const controlIndex = childArray.findIndex((child) => {
    if (!isValidElement(child)) return false;
    const isNativeControl =
      typeof child.type === "string" &&
      ["input", "select", "textarea"].includes(child.type);
    return isNativeControl || typeof child.type !== "string";
  });
  const decoratedChildren = childArray.map((child, index) => {
    if (index !== controlIndex || !isValidElement(child)) return child;

    const childProps = child.props as FieldControlProps;
    const existingDescribedBy = childProps["aria-describedby"];
    const mergedDescribedBy = [existingDescribedBy, describedBy]
      .filter(Boolean)
      .join(" ") || undefined;

    return cloneElement(child as ReactElement<FieldControlProps>, {
      "aria-describedby": mergedDescribedBy,
      "aria-invalid": error ? true : childProps["aria-invalid"],
      ...(required ? { required: true } : {}),
    });
  });

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <Label htmlFor={htmlFor} required={required} {...props}>
        {label}
      </Label>
      {decoratedChildren}
      {hint && !error ? (
        <span id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </span>
      ) : null}
      {error ? (
        <span id={errorId} className="text-xs text-destructive" role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}
