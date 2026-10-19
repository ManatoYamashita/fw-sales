import { describe, expect, it } from "vitest";
import { buildCss } from "@/components/ui/__tests__/support/build-css";
import { scanProductionSources } from "@/components/ui/__tests__/support/tailwind-sources";

const RESPONSIVE_CLASSES = [
  "@container/review",
  "@min-[60rem]/review:grid-cols-[13rem_minmax(0,1fr)]",
  "@min-[60rem]/review:block",
  "@min-[60rem]/review:hidden",
  "@min-[40rem]/review:flex",
  "@min-[40rem]/review:hidden",
  "@container/flow",
  "@min-[40rem]/flow:flex-row",
  "[@media(max-height:30rem)]:static",
  "[@media(max-height:30rem)]:max-h-none",
  "[&_:is(button,textarea,summary,a)]:scroll-mb-[50dvh]",
];

describe("調査詳細のレスポンシブ境界", () => {
  it("本番の走査でもレスポンシブ規則が欠落しない", async () => {
    const { candidates } = await scanProductionSources();
    for (const value of RESPONSIVE_CLASSES) expect(candidates).toContain(value);
  });

  it("カテゴリ欄はサイドバー込みの実効幅を使い、40rem未満の本文を作らない", async () => {
    const css = await buildCss(RESPONSIVE_CLASSES);
    expect(css).toContain("container-type: inline-size");
    expect(css).toContain("container-name: review");
    expect(css).toContain("@container review (width >= 60rem)");
    expect(css).toContain("grid-template-columns: 13rem minmax(0,1fr)");
  });

  it("完了操作と手順表示はviewportではなく各コンテナに追従する", async () => {
    const css = await buildCss(RESPONSIVE_CLASSES);
    expect(css).toContain("@container review (width >= 40rem)");
    expect(css).toContain("@container flow (width >= 40rem)");
    expect(css).toContain("display: none");
    expect(css).toContain("flex-direction: row");
  });

  it("短い画面では固定操作欄の張り付きを解除し、内部スクロールに閉じ込めない", async () => {
    const css = await buildCss(RESPONSIVE_CLASSES);
    expect(css).toContain("@media (max-height:30rem)");
    expect(css).toContain("position: static");
    expect(css).toContain("max-height: none");
    expect(css).toContain("scroll-margin-bottom: 50dvh");
  });
});
