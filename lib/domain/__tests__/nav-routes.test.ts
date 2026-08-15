/**
 * `lib/domain/nav-routes.ts` と `lib/domain/nav.ts` の整合テスト。
 *
 * `DISABLED_ROUTE_PREFIXES` (proxy が参照する URL プレフィクス) と
 * `NAV_ITEMS[].disabled` (サイドバーのグレーアウト) は必ず一対一で対応させる
 * 運用ルールになっている。従来この 2 つは別々のファイルにハードコードされ、
 * 双方のコメントが互いに「相手が単一の真実」と主張し合う二重管理だった
 * (しかも nav.ts 側の export はどこからも import されていなかった)。
 *
 * nav-routes.ts への一本化後も、`NAV_ITEMS` に disabled を足しただけで
 * プレフィクスを足し忘れると「サイドバーでは押せないが直接 URL では入れる」
 * という穴が開く。その乖離をここで機械的に検知する。
 */

import { describe, expect, it } from "vitest";

import { NAV_ITEMS } from "../nav";
import {
  DISABLED_ROUTE_PREFIXES,
  FALLBACK_ENABLED_ROUTE,
  isDisabledPath,
} from "../nav-routes";

describe("DISABLED_ROUTE_PREFIXES と NAV_ITEMS[].disabled の整合", () => {
  it("disabled な NAV_ITEM の href 集合と完全に一致する", () => {
    const disabledHrefs = NAV_ITEMS.filter((item) => item.disabled).map(
      (item) => item.href,
    );

    expect([...DISABLED_ROUTE_PREFIXES].sort()).toEqual(
      [...disabledHrefs].sort(),
    );
  });

  it("FALLBACK_ENABLED_ROUTE は disabled でない NAV_ITEM を指す", () => {
    const fallback = NAV_ITEMS.find(
      (item) => item.href === FALLBACK_ENABLED_ROUTE,
    );

    expect(fallback).toBeDefined();
    expect(fallback?.disabled).toBeFalsy();
  });

  it("FALLBACK_ENABLED_ROUTE 自身は disabled 判定されない (リダイレクトループ防止)", () => {
    expect(isDisabledPath(FALLBACK_ENABLED_ROUTE)).toBe(false);
  });
});

describe("isDisabledPath", () => {
  it("プレフィクス完全一致を disabled と判定する", () => {
    expect(isDisabledPath("/dashboard")).toBe(true);
    expect(isDisabledPath("/kpi")).toBe(true);
  });

  it("`/` 区切りの子パスを disabled と判定する", () => {
    expect(isDisabledPath("/handoffs/abc-123")).toBe(true);
    expect(isDisabledPath("/pipeline/deep/nested")).toBe(true);
  });

  it("プレフィクスが前方一致するだけの別ルートは巻き込まない", () => {
    expect(isDisabledPath("/kpi-report")).toBe(false);
    expect(isDisabledPath("/dashboards")).toBe(false);
    expect(isDisabledPath("/actionsX")).toBe(false);
  });

  it("有効なルートは disabled と判定しない", () => {
    expect(isDisabledPath("/stores")).toBe(false);
    expect(isDisabledPath("/stores/abc-123/edit")).toBe(false);
    expect(isDisabledPath("/research")).toBe(false);
    expect(isDisabledPath("/settings")).toBe(false);
  });
});
