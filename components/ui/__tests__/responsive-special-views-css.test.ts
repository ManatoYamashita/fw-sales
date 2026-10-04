import { describe, expect, it } from "vitest";
import { buildCss } from "./support/build-css";
import { scanProductionSources } from "./support/tailwind-sources";

const REQUIRED_CLASSES = [
  "@min-[430px]:grid-cols-[6rem_minmax(0,1fr)_3rem_3rem]",
  "@min-[700px]:flex-row",
  "@min-[800px]:grid-cols-[minmax(0,1fr)_400px]",
  "@min-[800px]:h-[520px]",
  "max-h-[70dvh]",
  "[overflow-wrap:anywhere]",
];

describe("特殊ビューのレスポンシブ CSS", () => {
  it("実装で使うコンテナ閾値と高さ制約が本番走査で検出される", async () => {
    const { candidates } = await scanProductionSources();
    for (const className of REQUIRED_CLASSES) {
      expect(candidates, className).toContain(className);
    }
  });

  it("閾値は viewport ではなくコンテナ幅に作用する", async () => {
    const css = await buildCss(REQUIRED_CLASSES);
    expect(css).toContain("@container (width >= 430px)");
    expect(css).toContain("grid-template-columns: 6rem minmax(0,1fr) 3rem 3rem");
    expect(css).toContain("@container (width >= 700px)");
    expect(css).toContain("flex-direction: row");
    expect(css).toContain("@container (width >= 800px)");
    expect(css).toContain("grid-template-columns: minmax(0,1fr) 400px");
    expect(css).toContain("height: 520px");
    expect(css).toContain("max-height: 70dvh");
    expect(css).toContain("overflow-wrap: anywhere");
  });
});
