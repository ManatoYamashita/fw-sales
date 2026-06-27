"use client";

import { useSyncExternalStore } from "react";

const NOOP_SUBSCRIBE = () => () => {};
const TRUE_SNAPSHOT = () => true;
const FALSE_SNAPSHOT = () => false;

/**
 * クライアントでのマウント完了後に true を返す。
 *
 * `useState` + `useEffect(() => setMounted(true), [])` と同じ目的だが、
 * `useSyncExternalStore` のサーバースナップショットを使うことで
 * effect 内での setState を避け、hydration mismatch も起こさない。
 */
export function useMounted(): boolean {
  return useSyncExternalStore(NOOP_SUBSCRIBE, TRUE_SNAPSHOT, FALSE_SNAPSHOT);
}
