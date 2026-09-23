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

export const TOAST_TIMEOUT_MS = 5000;
let toasts: Toast[] = [];
const listeners = new Set<Listener>();

interface ToastTimer {
  timeoutId: ReturnType<typeof setTimeout> | null;
  deadline: number;
  remaining: number;
}

const toastTimers = new Map<string, ToastTimer>();

function emit() {
  for (const listener of listeners) listener(toasts);
}

function clearToastTimer(id: string): void {
  const timer = toastTimers.get(id);
  if (!timer) return;
  if (timer.timeoutId !== null) clearTimeout(timer.timeoutId);
  toastTimers.delete(id);
}

function scheduleToastDismiss(id: string, delay: number): void {
  clearToastTimer(id);
  const remaining = Math.max(delay, 0);
  const timer: ToastTimer = {
    timeoutId: null,
    deadline: Date.now() + remaining,
    remaining,
  };
  timer.timeoutId = setTimeout(() => {
    toastTimers.delete(id);
    dismissToast(id);
  }, remaining);
  toastTimers.set(id, timer);
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
  if (tone !== "error") scheduleToastDismiss(toast.id, TOAST_TIMEOUT_MS);
}

export function dismissToast(id: string) {
  clearToastTimer(id);
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

export function getToasts(): readonly Toast[] {
  return toasts;
}

/** 自動消去対象のトーストを、ホバーまたはフォーカス中だけ停止する。 */
export function pauseToast(id: string): void {
  const timer = toastTimers.get(id);
  if (!timer || timer.timeoutId === null) return;
  clearTimeout(timer.timeoutId);
  timer.timeoutId = null;
  timer.remaining = Math.max(timer.deadline - Date.now(), 0);
}

/** 停止していたトーストの残り時間を再開する。 */
export function resumeToast(id: string): void {
  const timer = toastTimers.get(id);
  if (!timer || timer.timeoutId !== null) return;
  scheduleToastDismiss(id, timer.remaining);
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
