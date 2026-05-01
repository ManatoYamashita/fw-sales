"use client";

import { useSyncExternalStore } from "react";
import { generateId } from "@/lib/utils/id";

export type ToastTone = "info" | "success" | "warning" | "error";

export interface Toast {
  id: string;
  tone: ToastTone;
  message: string;
  createdAt: number;
}

type Listener = (toasts: Toast[]) => void;

const TOAST_TIMEOUT_MS = 4000;
let toasts: Toast[] = [];
const listeners = new Set<Listener>();

function emit() {
  for (const listener of listeners) listener(toasts);
}

function pushToast(message: string, tone: ToastTone = "info") {
  const toast: Toast = {
    id: generateId("toast"),
    tone,
    message,
    createdAt: Date.now(),
  };
  toasts = [...toasts, toast];
  emit();
  setTimeout(() => dismissToast(toast.id), TOAST_TIMEOUT_MS);
}

export function dismissToast(id: string) {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

export const toast = {
  show: (message: string, tone: ToastTone = "info") => pushToast(message, tone),
  success: (message: string) => pushToast(message, "success"),
  error: (message: string) => pushToast(message, "error"),
  warn: (message: string) => pushToast(message, "warning"),
  info: (message: string) => pushToast(message, "info"),
};

function subscribe(listener: Listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot() {
  return toasts;
}

const EMPTY_TOASTS: Toast[] = [];

function getServerSnapshot() {
  return EMPTY_TOASTS;
}

export function useToasts(): Toast[] {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
