import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Input, INPUT_SIZE_CLASSES } from "../input";
import { Select, SELECT_DENSITY_CLASSES } from "../select";

// 実装の表を直接走査し、新しい density も検査対象に含める (#257)。
const cases = [
  ...Object.entries(INPUT_SIZE_CLASSES).map(([size, classes]) => ({
    name: `Input ${size}`,
    classes,
    html: renderToStaticMarkup(<Input />),
  })),
  ...Object.entries(SELECT_DENSITY_CLASSES).flatMap(([density, classes]) =>
    (["full", "auto"] as const).map((width) => ({
      name: `Select ${density} ${width}`,
      classes,
      html: renderToStaticMarkup(
        <Select width={width} density={density as keyof typeof SELECT_DENSITY_CLASSES}>
          <option>選択肢</option>
        </Select>,
      ),
    })),
  ),
];

describe("入力系のタッチターゲット (#257)", () => {
  it.each(cases)("$name はモバイルの下限を持ち、md で解除する", ({ name, classes }) => {
    const tokens = classes.split(/\s+/);
    expect(tokens, name).toContain("min-h-11");
    expect(tokens, name).toContain("md:min-h-0");
    expect(tokens.filter((token) => /:h-/.test(token)), name).toEqual([]);
  });

  it.each(cases)("$name のサイズ指定は実際の描画へ配線される", ({ name, classes, html }) => {
    const rendered = /class="([^"]*)"/.exec(html)?.[1]?.split(/\s+/) ?? [];
    for (const token of classes.split(/\s+/)) {
      expect(rendered, `${name}: ${token} が描画されていない`).toContain(token);
    }
  });

  it("デスクトップの高さは Input / default 36px、compact 32px のまま", () => {
    expect(INPUT_SIZE_CLASSES.default.split(/\s+/)).toContain("h-9");
    expect(SELECT_DENSITY_CLASSES.default.split(/\s+/)).toContain("h-9");
    expect(SELECT_DENSITY_CLASSES.compact.split(/\s+/)).toContain("h-8");
  });

  it("Select の既定 density にも下限が適用される", () => {
    const html = renderToStaticMarkup(<Select width="auto" />);
    expect(html).toContain("min-h-11 md:min-h-0");
    expect(html).not.toMatch(/\sdensity=/);
  });
});
