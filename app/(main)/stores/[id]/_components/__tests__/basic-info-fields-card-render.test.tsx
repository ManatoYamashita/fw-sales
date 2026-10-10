/**
 * 「店舗の調査情報」カードの描画 (#335)。
 *
 * - 冒頭で用途と AI 調査からの反映経路を示す
 * - 各項目は最初から入力欄で、「編集」ボタンで表示を切り替えない
 * - 信頼度はスコアだけで色を決め、空欄・スコアの無い値には色を付けない
 *   (旧表示は空欄にも既定の取得区分から「A・高信頼」を出していた)
 *
 * jsdom を持たないため `renderToStaticMarkup` で静的 HTML を検証する
 * (research-review-section-render.test.tsx と同じ方式)。
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { BasicInfo, BasicInfoField } from "@/types/basic-info";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/actions/basic-info-actions", () => ({ updateBasicInfoFieldAction: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const { BasicInfoFieldsCard, BASIC_INFO_CARD_LEAD, BASIC_INFO_CARD_TITLE } = await import(
  "../basic-info-fields-card"
);

function adopted(value: string, confidence: number | undefined): BasicInfoField {
  return {
    value,
    tier: "B",
    confidence,
    source_urls: ["https://example.com/menu"],
    source_quote: "公式サイトのメニューに記載",
    filled_by: "manual",
    updated_at: "2026-10-09T15:30:00.000Z",
  };
}

const BASIC_INFO: BasicInfo = {
  // 空欄 (既定の取得区分は A)。
  store_name: { value: null, tier: "A", filled_by: null, updated_at: "2026-10-01T00:00:00.000Z" },
  average_spend_day_night: adopted("昼 1,000円 / 夜 4,000円", 92),
  seat_count: adopted("24席", 75),
  concept: adopted("炭火と地酒", 20),
  // 直接入力 (スコアなし)。
  phone: { value: "03-1234-5678", tier: "A", filled_by: "manual", updated_at: "2026-10-01T00:00:00.000Z" },
};

function render(basicInfo: BasicInfo = BASIC_INFO): string {
  return renderToStaticMarkup(<BasicInfoFieldsCard storeId="store-1" basicInfo={basicInfo} />);
}

/** 項目ごとの `<li>` を、入力欄の id (basic-info-<key>) で取り出す。 */
function row(html: string, key: string): string {
  const rows = html.match(/<li[\s\S]*?<\/li>/g) ?? [];
  const found = rows.find((r) => r.includes(`id="basic-info-${key}"`));
  if (!found) throw new Error(`${key} の行がありません`);
  return found;
}

describe("BasicInfoFieldsCard", () => {
  it("用途が分かる見出しと、AI 調査からの反映・営業資産への利用を冒頭で示す", () => {
    const html = render();
    expect(html).toContain(BASIC_INFO_CARD_TITLE);
    expect(html).toContain(BASIC_INFO_CARD_LEAD);
    expect(BASIC_INFO_CARD_LEAD).toContain("レビューで採用すると反映");
    expect(BASIC_INFO_CARD_LEAD).toContain("営業資産の生成に使われます");
    expect(html).toContain("入力済み 4 / 53");
    // 全件 4 件はすべて最初のカテゴリ (14 項目) に入っている。
    expect(html).toContain("入力済み 4 / 14");
    expect(html).toContain("入力済み 0 / 6");
    expect(html).not.toContain("充足");
  });

  it("全項目が最初から入力欄で、表示を切り替える「編集」ボタンや保存ボタンは出ない", () => {
    const html = render();
    expect(html.match(/<li/g)).toHaveLength(53);
    expect(html.match(/<(input|textarea)\b/g)).toHaveLength(53);
    expect(html).not.toMatch(/<button[^>]*>[^<]*編集/);
    expect(html).not.toMatch(/aria-label="[^"]*を編集"/);
    expect(html).not.toMatch(/<button[^>]*type="submit"/);
    // 入力欄にはラベルが結び付いている。
    expect(row(html, "phone")).toMatch(/<label[^>]*for="basic-info-phone"/);
  });

  it("空欄には信頼度を出さず、取得区分を高信頼として見せない", () => {
    const html = render();
    const empty = row(html, "store_name");
    expect(empty).not.toContain("data-trust");
    expect(empty).not.toContain("高信頼");
    expect(empty).not.toContain("A・");
    expect(empty).toContain('placeholder="未入力"');
    expect(html).not.toContain("高信頼");
  });

  it("スコアのある値は 3 段階の色と文字で、スコアの無い値は色なしの「未評価」で出す", () => {
    const html = render();
    expect(row(html, "average_spend_day_night")).toMatch(/data-trust="high"[\s\S]*高/);
    expect(row(html, "seat_count")).toMatch(/data-trust="check"[\s\S]*要確認/);
    expect(row(html, "concept")).toMatch(/data-trust="low"[\s\S]*低/);
    const typed = row(html, "phone");
    expect(typed).not.toContain("data-trust");
    expect(typed).toContain("未評価");
    // 色の意味は読み上げでも伝わる。
    expect(row(html, "seat_count")).toContain('<span class="sr-only">信頼度 </span>');
  });

  it("出典・引用・由来は「根拠・詳細」に畳み、採用値を直接入力と表示しない", () => {
    const html = render();
    const r = row(html, "average_spend_day_night");
    expect(r).toMatch(/<details[\s\S]*<summary[\s\S]*根拠・詳細[\s\S]*https:\/\/example\.com\/menu/);
    expect(r).toContain("AI調査の結果をレビューで採用");
    expect(r).toContain("スコア 92");
    expect(r).toContain("2026/10/10 00:30");
    expect(row(html, "phone")).toContain("人が入力した値");
    // 空欄でヒアリングの質問も無い項目には、開く中身が無いので出さない。
    expect(row(html, "store_name")).not.toContain("根拠・詳細");
  });

  it("短い項目は 1 行の Input、長文の項目は Textarea", () => {
    const html = render();
    expect(row(html, "phone")).toMatch(/<input[^>]*id="basic-info-phone"/);
    expect(row(html, "concept")).toMatch(/<textarea[^>]*id="basic-info-concept"/);
  });
});
