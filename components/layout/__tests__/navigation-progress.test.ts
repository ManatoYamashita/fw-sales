/**
 * 進行バーを開始するクリックの判定 (#326)。
 *
 * ここが緩いと、新しいタブで開いた・外部サイトへ出た・同じ画面のハッシュへ
 * 飛んだだけでバーが出て、完了しないまま (タイムアウトまで) 残る。
 */

import { describe, expect, it } from "vitest";
import {
  isTrackableNavigationClick,
  type NavigationAnchor,
  type NavigationClick,
} from "../navigation-progress";

const CURRENT = { href: "https://sales.example.com/stores?tab=all" };
const PLAIN: NavigationClick = {
  button: 0,
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
};
const anchor = (href: string, extra: Partial<NavigationAnchor> = {}): NavigationAnchor => ({
  href,
  target: "",
  hasDownload: false,
  ...extra,
});

describe("isTrackableNavigationClick", () => {
  it("同じオリジンの別の画面へのリンクは対象", () => {
    expect(isTrackableNavigationClick(PLAIN, anchor("/stores/abc"), CURRENT)).toBe(true);
  });

  it("同じ画面でもクエリが変われば対象 (一覧の絞り込みリンクなど)", () => {
    expect(isTrackableNavigationClick(PLAIN, anchor("/stores?tab=mine"), CURRENT)).toBe(true);
  });

  it("同じ URL や、ハッシュだけが違うリンクは対象外", () => {
    expect(isTrackableNavigationClick(PLAIN, anchor("/stores?tab=all"), CURRENT)).toBe(false);
    expect(isTrackableNavigationClick(PLAIN, anchor("/stores?tab=all#list"), CURRENT)).toBe(false);
  });

  it("外部オリジンは対象外", () => {
    expect(isTrackableNavigationClick(PLAIN, anchor("https://maps.google.com/x"), CURRENT)).toBe(false);
  });

  it("新しいタブで開く操作は対象外 (修飾キー・中クリック・target=_blank)", () => {
    for (const key of ["metaKey", "ctrlKey", "shiftKey", "altKey"] as const) {
      expect(isTrackableNavigationClick({ ...PLAIN, [key]: true }, anchor("/stores/abc"), CURRENT)).toBe(false);
    }
    expect(isTrackableNavigationClick({ ...PLAIN, button: 1 }, anchor("/stores/abc"), CURRENT)).toBe(false);
    expect(isTrackableNavigationClick(PLAIN, anchor("/stores/abc", { target: "_blank" }), CURRENT)).toBe(false);
  });

  it("target=_self は同じタブなので対象", () => {
    expect(isTrackableNavigationClick(PLAIN, anchor("/stores/abc", { target: "_self" }), CURRENT)).toBe(true);
  });

  it("ダウンロードリンクは対象外", () => {
    expect(isTrackableNavigationClick(PLAIN, anchor("/api/export", { hasDownload: true }), CURRENT)).toBe(false);
  });

  it("URL として読めない href は対象外 (例外を投げない)", () => {
    expect(isTrackableNavigationClick(PLAIN, anchor("http://[invalid"), CURRENT)).toBe(false);
  });
});
