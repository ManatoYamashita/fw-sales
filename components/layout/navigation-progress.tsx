"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

/**
 * 画面上部の進行バー (#326)。
 *
 * リンクを押してから次の画面のシェルが描かれるまでの間、何も変わらず「固まった」
 * ように見えるのを防ぐ。Next.js にはナビゲーション開始の共通イベントが無いため、
 * 同一オリジンのリンクのクリックを document の capture 段で拾って開始し、
 * URL (pathname + search) が変わったら完了とする。
 *
 * - 速い遷移ではちらつかせないよう、表示は 100ms 遅らせる (globals.css)
 * - 読み込み中の状態は読み上げない。`aria-hidden` にし、live region も使わない
 * - 遷移が起きなかった場合 (リンク側で中断された等) に出しっぱなしにしないよう、
 *   一定時間で自動的に閉じる
 */

type Phase = "idle" | "loading" | "done";

/** 完了表示 (バーが伸び切って消える) を見せる時間。 */
const DONE_HOLD_MS = 400;
/** 遷移が完了しなかったときに諦めて閉じるまでの時間。 */
const LOADING_TIMEOUT_MS = 15_000;

export interface NavigationClick {
  button: number;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

export interface NavigationAnchor {
  href: string;
  target: string;
  hasDownload: boolean;
}

/**
 * そのクリックがアプリ内の別画面への遷移を始めるかを判定する。
 *
 * 新しいタブで開く操作・外部リンク・ダウンロード・同じ URL (ハッシュだけの違いを
 * 含む) は、この画面のままなので対象外。
 */
export function isTrackableNavigationClick(
  click: NavigationClick,
  anchor: NavigationAnchor,
  current: { href: string },
): boolean {
  if (click.button !== 0) return false;
  if (click.metaKey || click.ctrlKey || click.shiftKey || click.altKey) {
    return false;
  }
  if (anchor.target !== "" && anchor.target !== "_self") return false;
  if (anchor.hasDownload) return false;

  let next: URL;
  let now: URL;
  try {
    now = new URL(current.href);
    next = new URL(anchor.href, now);
  } catch {
    return false;
  }
  if (next.origin !== now.origin) return false;
  return next.pathname !== now.pathname || next.search !== now.search;
}

export function NavigationProgress() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const urlKey = `${pathname}?${searchParams.toString()}`;

  const [phase, setPhase] = useState<Phase>("idle");
  const [trackedUrlKey, setTrackedUrlKey] = useState(urlKey);

  // URL が変わったら完了。effect ではなく描画中に前回値と比べて更新する
  // (React の「props の変化に応じて state を調整する」パターン)。
  if (trackedUrlKey !== urlKey) {
    setTrackedUrlKey(urlKey);
    if (phase === "loading") setPhase("done");
  }

  useEffect(() => {
    function handleClick(event: MouseEvent) {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest("a[href]");
      if (!(anchor instanceof HTMLAnchorElement)) return;
      const trackable = isTrackableNavigationClick(
        event,
        {
          href: anchor.href,
          target: anchor.target,
          hasDownload: anchor.hasAttribute("download"),
        },
        window.location,
      );
      if (trackable) setPhase("loading");
    }
    document.addEventListener("click", handleClick, { capture: true });
    return () =>
      document.removeEventListener("click", handleClick, { capture: true });
  }, []);

  useEffect(() => {
    if (phase === "idle") return;
    const timeoutId = setTimeout(
      () => setPhase("idle"),
      phase === "done" ? DONE_HOLD_MS : LOADING_TIMEOUT_MS,
    );
    return () => clearTimeout(timeoutId);
  }, [phase]);

  return (
    <div
      aria-hidden
      data-phase={phase}
      data-slot="navigation-progress"
      className="nav-progress pointer-events-none fixed inset-x-0 top-0 z-[70] h-0.5"
    >
      <div className="nav-progress-bar h-full origin-left bg-primary" />
    </div>
  );
}
