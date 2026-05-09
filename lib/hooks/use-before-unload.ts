"use client";

/**
 * Hard navigation 警告(タブ閉じ / ブラウザ戻る / 外部リンク遷移)用 hook。
 *
 * - `enabled === true` のときのみ `beforeunload` を購読し、ブラウザ標準の確認
 *   ダイアログを誘発する(モダンブラウザは独自メッセージを表示しないため、
 *   `e.returnValue = ""` のセットだけで十分)
 * - Next.js App Router の **soft navigation**(`<Link>` / `router.push`)は
 *   `beforeunload` で捕捉できない。soft nav の警告は本 spec のスコープ外
 *   (research.md Topic 5、別 Issue で対応)
 *
 * 関連: design.md §「useBeforeUnload」, requirements.md §6.4
 */

import { useEffect } from "react";

/**
 * ページ離脱時に標準の確認ダイアログを表示する。
 *
 * @param enabled true のときだけ beforeunload を購読する。
 *   AI 分析結果が未保存である等の dirty フラグを渡すこと。
 */
export function useBeforeUnload(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // 一部の古いブラウザは returnValue の代入で初めてダイアログを誘発する
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => {
      window.removeEventListener("beforeunload", handler);
    };
  }, [enabled]);
}
