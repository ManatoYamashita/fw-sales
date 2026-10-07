/**
 * `SalesAssetSection` (営業資産生成の唯一の入口、Issue #300) の描画レベル検証。
 *
 * 文脈 (レビュー済み / 未レビュー / 調査中 / 調査なし) ごとに、「何が生成に使われるか」の
 * 説明とボタンの強さ・ラベルが出し分けられることを固定する。jsdom を入れていないため、
 * 既存の `research-failed-card-render.test.tsx` と同じく `renderToStaticMarkup` を使う。
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { SalesAssetGenerationContext } from "@/lib/domain/research-flow";
import type { Store } from "@/types/store";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/actions/sales-assets-actions", () => ({
  generateSalesAssetsAction: vi.fn(),
}));
vi.mock("@/lib/actions/store-actions", () => ({
  updateStorePatchAction: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const { SalesAssetSection, SALES_ASSETS_SECTION_ID } = await import("../sales-asset-section");
const { BUTTON_VARIANT_CLASSES } = await import("@/components/ui/button");

const STORE = {
  id: "store-1",
  name: "関内 なむら",
  basic_info: {
    address: { value: "横浜市中区", tier: "A", filled_by: "manual", updated_at: "2026-10-07T00:00:00.000Z" },
    phone: { value: null, tier: "A", filled_by: null, updated_at: "2026-10-07T00:00:00.000Z" },
  },
  ai_analysis_result: null,
} as unknown as Store;

function render(
  context: SalesAssetGenerationContext,
  opts: { isApiKeyConfigured?: boolean; store?: Store } = {},
): string {
  return renderToStaticMarkup(
    <SalesAssetSection
      store={opts.store ?? STORE}
      context={context}
      isApiKeyConfigured={opts.isApiKeyConfigured ?? true}
      onJumpToReview={() => {}}
    />,
  );
}

/** 生成ボタン (Sparkles アイコン付きの button) の開始タグとテキストを返す。 */
function generateButton(html: string): { tag: string; text: string } {
  const match = html.match(/(<button[^>]*>)<svg[^>]*lucide-sparkles[\s\S]*?<\/svg>([^<]*)<\/button>/);
  if (!match) throw new Error("生成ボタンが見つからない");
  return { tag: match[1] ?? "", text: match[2] ?? "" };
}

describe("SalesAssetSection", () => {
  it("深いリンクの着地点 id を持つ", () => {
    expect(SALES_ASSETS_SECTION_ID).toBe("sales-assets");
    expect(render({ kind: "reviewed" })).toContain(`id="sales-assets"`);
  });

  it("使用する基本情報の件数を出す (充填済みのみ数える)", () => {
    expect(render({ kind: "reviewed" })).toMatch(/基本情報 1 \/ \d+ 件を使用/);
  });

  it("レビュー済み: 主導線 (primary) で「営業資産を生成」、警告なし", () => {
    const html = render({ kind: "reviewed" });
    const button = generateButton(html);
    expect(button.text).toBe("営業資産を生成");
    expect(button.tag).toContain(BUTTON_VARIANT_CLASSES.primary);
    expect(html).not.toContain("レビューで採用するまで生成に使われません");
  });

  it("未レビュー: 未対応件数つきの警告と ② へ戻るボタン、生成は secondary で飛ばす手順を明示", () => {
    const html = render({ kind: "unreviewed", undecidedCount: 32 });
    expect(html).toContain("未対応の 32 件は、レビューで採用するまで生成に使われません");
    expect(html).toContain("② レビューへ戻る");
    const button = generateButton(html);
    expect(button.text).toBe("レビューせずに生成");
    expect(button.tag).toContain(BUTTON_VARIANT_CLASSES.secondary);
  });

  it("未レビューでも未対応 0 件なら警告ではなく、反映済みの旨を添える", () => {
    const html = render({ kind: "unreviewed", undecidedCount: 0 });
    expect(html).not.toContain("② レビューへ戻る");
    expect(html).toContain("基本情報に反映済み");
  });

  it("調査なし: 「AI調査をせずに生成」", () => {
    expect(generateButton(render({ kind: "none" })).text).toBe("AI調査をせずに生成");
  });

  it("補足情報欄は Gemini 等の外部調査テキストの貼付先であることを書き、5 万字まで受け付ける", () => {
    const html = render({ kind: "reviewed" });
    expect(html).toContain("補足情報(任意)");
    expect(html).toContain("Gemini などで別途調べた結果を貼り付けられます");
    expect(html).toMatch(/id="sales-assets-supplement"[^>]*maxLength="50000"|maxLength="50000"[^>]*id="sales-assets-supplement"/);
  });

  it("API キー未設定なら生成ボタンを無効化し、理由を常時表示する", () => {
    const html = render({ kind: "reviewed" }, { isApiKeyConfigured: false });
    expect(generateButton(html).tag).toContain("disabled");
    expect(html).toContain("GEMINI_API_KEY が未設定のため生成できません");
  });

  it("生成済みなら、架電スクリプトを先頭に編集欄とコピーボタンを出し、ボタンは「再生成」", () => {
    const store = {
      ...STORE,
      review_completed_at: null,
      ai_analysis_result: {
        strengths_markdown: "駅近",
        weaknesses_markdown: "席数が少ない",
        gourmet_paid_status: "不明",
        gbp_completeness: "低",
        call_script: "私ファーストWEBの",
        confidence: {},
      },
    } as unknown as Store;
    const html = render({ kind: "reviewed" }, { store });
    expect(generateButton(html).text).toBe("営業資産を再生成");
    expect(html.indexOf("ai-call_script")).toBeLessThan(html.indexOf("ai-strengths_markdown"));
    expect(html).toContain(`<span class="sr-only">架電スクリプトを</span>`);
  });
});
