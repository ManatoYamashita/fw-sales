/**
 * 共通 Select (#334) の初期描画とフォーム連携の契約。
 *
 * jsdom は未導入なので renderToStaticMarkup の HTML を見る (`form-field-a11y.test.tsx`
 * と同じ規約)。開閉・キー操作の判定は `select-logic.test.ts`、実ブラウザでの操作は
 * `e2e/custom-select.spec.ts` が受け持つ。
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FormField } from "../form-field";
import { Select, selectTriggerClasses } from "../select";

const OPTIONS = [
  { value: "", label: "未割当" },
  { value: "uuid-1", label: "山田" },
  { value: "uuid-2", label: "佐藤" },
];

/** 開始タグを列挙する。 */
const tags = (html: string, name: string) =>
  html.match(new RegExp(`<${name}\\b[^>]*>`, "g")) ?? [];

describe("トリガーのセマンティクス", () => {
  it("select-only combobox の button として描画し、ネイティブの select を出さない", () => {
    const html = renderToStaticMarkup(
      <Select width="full" id="sales" options={OPTIONS} defaultValue="uuid-1" />,
    );
    expect(html).not.toContain("<select");
    expect(html).not.toContain("<option");
    const [button] = tags(html, "button");
    expect(button).toContain('type="button"');
    expect(button).toContain('id="sales"');
    expect(button).toContain('role="combobox"');
    expect(button).toContain('aria-haspopup="listbox"');
    expect(button).toContain('aria-expanded="false"');
    // 閉じている間は候補パネルが DOM に無いので、存在しない id を指さない。
    expect(button).not.toContain("aria-controls");
    expect(button).not.toContain("aria-activedescendant");
    expect(html).toContain(">山田<");
  });

  it("閉じている間は候補パネルを描画しない (Tab 順・読み上げに重複を作らない)", () => {
    const html = renderToStaticMarkup(<Select width="full" options={OPTIONS} />);
    expect(html).not.toContain('role="listbox"');
    expect(html).not.toContain('role="option"');
  });

  it("FormField の説明・エラー・必須をトリガーへ結び付ける", () => {
    const html = renderToStaticMarkup(
      <FormField label="営業状態" htmlFor="status" required error="選んでください">
        <Select width="full" id="status" name="status" options={OPTIONS} />
      </FormField>,
    );
    const errorId = html.match(/<span id="([^"]+-error)"/)?.[1];
    const [button] = tags(html, "button");
    expect(tags(html, "label")[0]).toContain('for="status"');
    expect(button).toContain(`aria-describedby="${errorId}"`);
    expect(button).toContain('aria-invalid="true"');
    expect(button).toContain('aria-required="true"');
  });

  it("disabled は button の disabled で伝え、送信値も止める (ネイティブと同じ)", () => {
    const html = renderToStaticMarkup(
      <Select width="full" name="role" options={OPTIONS} value="uuid-2" disabled />,
    );
    expect(tags(html, "button")[0]).toContain("disabled");
    expect(tags(html, "input")[0]).toContain("disabled");
  });
});

describe("フォーム連携 (name による送信)", () => {
  it("非表示の入力で現在値を送る", () => {
    const html = renderToStaticMarkup(
      <Select width="full" name="assigned_sales_user_id" options={OPTIONS} defaultValue="uuid-2" />,
    );
    expect(html).toContain('type="hidden" name="assigned_sales_user_id" value="uuid-2"');
  });

  it("defaultValue が無ければ先頭の有効な候補を送る (ネイティブの select と同じ)", () => {
    const html = renderToStaticMarkup(
      <Select width="full" name="meeting_type" options={[{ value: "対面", label: "対面" }, { value: "電話", label: "電話" }]} />,
    );
    expect(html).toContain('name="meeting_type" value="対面"');
  });

  it("空値 (未割当) をそのまま送る", () => {
    const html = renderToStaticMarkup(
      <Select width="full" name="assigned_sales_user_id" options={OPTIONS} defaultValue="" />,
    );
    expect(html).toContain('name="assigned_sales_user_id" value=""');
    expect(html).toContain(">未割当<");
  });

  it("候補にない既存値は先頭へ置き換えず、そのまま送って placeholder を出す", () => {
    // ネイティブの select は先頭 (未割当) を表示・送信し、触っていない担当を消していた。
    const html = renderToStaticMarkup(
      <Select
        width="full"
        name="assigned_sales_user_id"
        options={OPTIONS}
        defaultValue="uuid-deleted"
        placeholder="不明な担当者"
      />,
    );
    expect(html).toContain('name="assigned_sales_user_id" value="uuid-deleted"');
    expect(html).toContain(">不明な担当者<");
    expect(html).not.toContain(">未割当<");
  });

  it("制御モードは value を表示・送信する", () => {
    const html = renderToStaticMarkup(
      <Select width="full" name="status" options={OPTIONS} value="uuid-1" onValueChange={() => {}} />,
    );
    expect(html).toContain('name="status" value="uuid-1"');
  });

  it("required は検証に参加する入力にし、Tab 順と読み上げからは外す", () => {
    // type="hidden" は制約検証の対象外なので、必須を伝えられない。
    const html = renderToStaticMarkup(
      <Select width="full" name="status" options={OPTIONS} defaultValue="" required />,
    );
    const [input] = tags(html, "input");
    expect(input).not.toContain('type="hidden"');
    expect(input).toContain("required");
    expect(input).toContain('tabindex="-1"');
    expect(input).toContain('aria-hidden="true"');
    expect(input).toContain('name="status"');
    expect(input).toContain('value=""');
  });

  it("name が無ければ送信しない", () => {
    const html = renderToStaticMarkup(<Select width="full" options={OPTIONS} />);
    expect(tags(html, "input")[0]).not.toContain("name=");
  });
});

describe("幅", () => {
  it("auto は最長ラベルで幅を決め、選び直しで揺れない (見えない候補は読み上げない)", () => {
    const html = renderToStaticMarkup(
      <Select width="auto" options={OPTIONS} defaultValue="uuid-1" aria-label="担当" />,
    );
    const sizers = html.match(/<span aria-hidden="true" data-label="[^"]*" class="invisible[^"]*"><\/span>/g) ?? [];
    // 候補 3 件 + placeholder 1 件。
    expect(sizers).toHaveLength(4);
    // 寸法取りはテキストノードを持たないので、トリガーの文字列は表示中の値だけになる。
    const text = html.replace(/<svg[\s\S]*?<\/svg>/g, "").replace(/<[^>]+>/g, "");
    expect(text).toBe("山田");
  });

  it("full は w-full を持つ", () => {
    expect(selectTriggerClasses({ width: "full" }).split(/\s+/)).toContain("w-full");
    expect(selectTriggerClasses({ width: "auto" }).split(/\s+/)).not.toContain("w-full");
  });

  it("どの density も md 未満で 44px のタッチ領域を持つ", () => {
    for (const density of ["default", "compact"] as const) {
      const classes = selectTriggerClasses({ width: "full", density }).split(/\s+/);
      expect(classes, density).toContain("min-h-11");
      expect(classes, density).toContain("md:min-h-0");
    }
    expect(selectTriggerClasses({ width: "full", density: "touch" }).split(/\s+/)).toContain(
      "h-11",
    );
  });
});
