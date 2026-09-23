import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FormField } from "../form-field";
import { Input } from "../input";

describe("FormField の説明と検証状態の配線", () => {
  it("hint を input の aria-describedby へ結び付ける", () => {
    const html = renderToStaticMarkup(
      <FormField label="店舗名" htmlFor="name" hint="正式名称を入力してください">
        <Input id="name" />
        <span>文字数カウンター</span>
      </FormField>,
    );
    const hintId = html.match(/<span id="([^"]+-hint)"/)?.[1];

    expect(hintId).toBeTypeOf("string");
    expect(html).toContain(`aria-describedby="${hintId}"`);
    expect(html).not.toMatch(/<span[^>]*aria-describedby[^>]*>文字数カウンター/);
  });

  it("error を aria-invalid と aria-describedby へ結び付け、required を伝える", () => {
    const html = renderToStaticMarkup(
      <FormField label="店舗名" htmlFor="name" required error="店舗名は必須です">
        <Input id="name" />
      </FormField>,
    );
    const errorId = html.match(/<span id="([^"]+-error)"/)?.[1];

    expect(errorId).toBeTypeOf("string");
    expect(html).toContain(`aria-describedby="${errorId}"`);
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain("required");
    expect(html).toContain(`id="${errorId}"`);
    expect(html).toContain('role="alert"');
  });
});
