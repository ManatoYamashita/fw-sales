import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { YenAmountInput } from "../yen-amount-input";

function render(defaultValue?: number | null) {
  return renderToStaticMarkup(
    <YenAmountInput id="estimate" name="estimate_amount" defaultValue={defaultValue} />,
  );
}

describe("YenAmountInput 初期描画", () => {
  it("defaultValue=100000をカンマ表示し、canonical hidden値を送信する", () => {
    const html = render(100000);
    expect(html).toContain('id="estimate"');
    expect(html).toContain('value="100,000"');
    expect(html).toContain('type="hidden" name="estimate_amount" value="100000"');
  });

  it.each([null, undefined])("defaultValue=%sではhidden値を空にする", (defaultValue) => {
    const html = render(defaultValue);
    expect(html).toContain('type="hidden" name="estimate_amount" value=""');
  });

  it("DB integer上限をカンマ表示し、canonical hidden値を送信する", () => {
    const html = render(2147483647);
    expect(html).toContain('value="2,147,483,647"');
    expect(html).toContain('type="hidden" name="estimate_amount" value="2147483647"');
  });
});
