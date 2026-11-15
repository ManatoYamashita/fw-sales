import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Input, INPUT_SIZE_CLASSES } from "../input";
import { Select, selectTriggerClasses, type SelectDensity } from "../select";

// 現行 Select の全 density をカバーする。touch は全幅で 44px を維持する (#334)。
const SELECT_HEIGHTS = {
  default: "h-9",
  compact: "h-8",
  touch: "h-11",
} satisfies Record<SelectDensity, string>;
const OPTIONS = [{ value: "one", label: "選択肢" }];

const cases = [
  ...Object.entries(INPUT_SIZE_CLASSES).map(([size, classes]) => ({
    name: `Input ${size}`,
    classes,
    responsive: true,
    html: renderToStaticMarkup(<Input />),
  })),
  ...Object.keys(SELECT_HEIGHTS).flatMap((key) => {
    const density = key as SelectDensity;
    return (["full", "auto"] as const).map((width) => ({
      name: `Select ${density} ${width}`,
      classes: selectTriggerClasses({ width, density }),
      responsive: density !== "touch",
      html: renderToStaticMarkup(
        <Select width={width} density={density} options={OPTIONS} />,
      ),
    }));
  }),
];

describe("入力系のタッチターゲット (#257)", () => {
  it.each(cases)("$name はモバイルで 44px を確保する", ({ name, classes, responsive }) => {
    const tokens = classes.split(/\s+/);
    if (responsive) {
      expect(tokens, name).toContain("min-h-11");
      expect(tokens, name).toContain("md:min-h-0");
    } else {
      expect(tokens, name).toContain("h-11");
      expect(tokens, name).not.toContain("md:min-h-0");
    }
    expect(tokens.filter((token) => /:h-/.test(token)), name).toEqual([]);
  });

  it.each(cases)("$name のサイズ指定は実際の描画へ配線される", ({ name, classes, html }) => {
    const rendered = /class="([^"]*)"/.exec(html)?.[1]?.split(/\s+/) ?? [];
    for (const token of classes.split(/\s+/)) {
      expect(rendered, `${name}: ${token} が描画されていない`).toContain(token);
    }
  });

  it("デスクトップは Input / default 36px、compact 32px、touch 44px を維持する", () => {
    expect(INPUT_SIZE_CLASSES.default.split(/\s+/)).toContain("h-9");
    for (const [key, height] of Object.entries(SELECT_HEIGHTS)) {
      expect(selectTriggerClasses({ width: "auto", density: key as SelectDensity }).split(/\s+/))
        .toContain(height);
    }
  });

  it("Select の既定 density にも下限が適用される", () => {
    const html = renderToStaticMarkup(<Select width="auto" options={OPTIONS} />);
    expect(html).toContain("min-h-11 md:min-h-0");
    expect(html).not.toMatch(/\sdensity=/);
  });
});
