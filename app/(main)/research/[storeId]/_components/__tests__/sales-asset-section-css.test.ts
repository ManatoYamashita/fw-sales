/**
 * `SalesAssetSection` の開閉 (Issue #322) が前提にしている**生成 CSS** を固定する。
 *
 * - 本文は `Card.Body` の `flex` を持ったまま `hidden` 属性で隠す。`flex` は `display` を
 *   上書きするので、隠れるのは Tailwind の preflight が `[hidden]` に `!important` 付きの
 *   `display: none` を当てているからである。これが崩れると閉じた本文が見えたまま、
 *   Tab で中の入力欄へ入れてしまう。
 * - 閉じている間の見出しの下線は、状態 variant (`data-[state=closed]:`) で消す。
 *   `cn` は素の clsx なので、勝つのは**生成 CSS で後に出た方**。variant が基底の
 *   `border-b` より後に出ることを確認する。
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildCss, normalize } from "@/components/ui/__tests__/support/build-css";

const SOURCE = path.resolve(import.meta.dirname, "../sales-asset-section.tsx");
const CLOSED_HEADER_CLASS = "data-[state=closed]:border-b-0";

describe("SalesAssetSection の開閉を支える CSS", () => {
  it("`hidden` 属性は `flex` より強く本文を隠す (preflight の !important)", async () => {
    const css = normalize(await buildCss(["flex"]));
    expect(css).toMatch(
      /\[hidden\]:where\(:not\(\[hidden=['"]until-found['"]\]\)\) \{ display: none !important;/,
    );
  });

  it("閉じた見出しの下線を消す variant は、基底の `border-b` より後に出力される", async () => {
    const css = await buildCss(["border-b", CLOSED_HEADER_CLASS]);
    const base = css.indexOf(".border-b {");
    const closed = css.indexOf(".data-\\[state\\=closed\\]\\:border-b-0");
    expect(base, "border-b が生成されていない").toBeGreaterThan(-1);
    expect(closed, "閉じた状態の variant が生成されていない").toBeGreaterThan(-1);
    expect(closed).toBeGreaterThan(base);
  });

  it("コンポーネントは上の 2 つを前提どおりに使っている", async () => {
    const source = await readFile(SOURCE, "utf8");
    expect(source).toContain(`className="${CLOSED_HEADER_CLASS}"`);
    expect(source).toContain(`data-state={open ? "open" : "closed"}`);
    expect(source).toMatch(/<Card\.Body id=\{SALES_ASSETS_BODY_ID\} hidden=\{!open\} className="flex /);
  });
});
