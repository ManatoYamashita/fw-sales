"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import {
  MODAL_BODY_CLASS,
  MODAL_DIALOG_CLASS,
  MODAL_FOOTER_CLASS,
  MODAL_HEADER_CLASS,
  MODAL_OVERLAY_CLASS,
  MODAL_WIDTH_CLASS,
  type ModalSize,
} from "./modal-classes";

interface ModalContextValue {
  open: boolean;
  setOpen: (next: boolean) => void;
  titleId: string;
}

const ModalContext = createContext<ModalContextValue | null>(null);

function useModalContext(): ModalContextValue {
  const ctx = useContext(ModalContext);
  if (!ctx) throw new Error("Modal compound must be used inside <Modal>");
  return ctx;
}

interface ModalProps {
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (next: boolean) => void;
  children: ReactNode;
}

export function Modal({
  defaultOpen = false,
  open,
  onOpenChange,
  children,
}: ModalProps) {
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const titleId = useId();
  const isControlled = open !== undefined;
  const value = isControlled ? open : internalOpen;

  // Keep a ref to the latest onOpenChange so setOpen stays stable even when
  // the caller passes a new inline function every render (e.g. inside a Dialog
  // that has its own state).  Updating the ref inside useLayoutEffect rather
  // than during render avoids the react-hooks/refs lint error.
  const onOpenChangeRef = useRef(onOpenChange);
  useLayoutEffect(() => {
    onOpenChangeRef.current = onOpenChange;
  });

  const setOpen = useCallback(
    (next: boolean) => {
      if (!isControlled) setInternalOpen(next);
      onOpenChangeRef.current?.(next);
    },
    [isControlled],
  );

  return (
    <ModalContext.Provider value={{ open: value, setOpen, titleId }}>
      {children}
    </ModalContext.Provider>
  );
}

export function ModalTrigger({ children }: { children: ReactNode }) {
  const { setOpen } = useModalContext();
  return (
    <span onClick={() => setOpen(true)} className="contents">
      {children}
    </span>
  );
}

interface ModalContentProps {
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  size?: ModalSize;
  className?: string;
}


export function ModalContent({
  title,
  description,
  children,
  size = "md",
  className,
}: ModalContentProps) {
  const { open, setOpen, titleId } = useModalContext();
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    previousFocusRef.current = document.activeElement as HTMLElement | null;

    const dialog = dialogRef.current;
    const focusables = dialog?.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    focusables?.[0]?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        return;
      }
      if (e.key !== "Tab" || !dialog) return;
      const items = dialog.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (items.length === 0) return;
      const first = items[0]!;
      const last = items[items.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
      previousFocusRef.current?.focus?.();
    };
  }, [open, setOpen]);

  if (!open) return null;
  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      className={MODAL_OVERLAY_CLASS}
      onClick={() => setOpen(false)}
      role="presentation"
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={cn(MODAL_DIALOG_CLASS, MODAL_WIDTH_CLASS[size], className)}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={MODAL_HEADER_CLASS}>
          <div>
            <h2
              id={titleId}
              className="text-base font-semibold tracking-tight text-foreground"
            >
              {title}
            </h2>
            {description ? (
              <p className="mt-1 text-sm text-muted-foreground leading-relaxed">
                {description}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            aria-label="閉じる"
            onClick={() => setOpen(false)}
            className="text-muted-foreground hover:text-foreground hover:bg-accent rounded-md h-8 w-8 inline-flex items-center justify-center transition-colors -mr-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className={MODAL_BODY_CLASS}>{children}</div>
      </div>
    </div>,
    document.body,
  );
}

export function ModalFooter({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(MODAL_FOOTER_CLASS, className)}
    >
      {children}
    </div>
  );
}
