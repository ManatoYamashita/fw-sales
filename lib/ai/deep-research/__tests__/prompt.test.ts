/**
 * `buildDeepResearchPrompt` の単体テスト
 * (deep-research-pipeline spec, Issue #43, Task 2.4)
 *
 * カバレッジ (3 ケース):
 * 1. 決定性: 同じ入力に対して同じ文字列を返す
 * 2. 51 項目キー名と A/B/C 凡例が prompt 内に必ず含まれる
 * 3. Stage 2 prompt は Stage 1 の Markdown を埋め込む
 *
 * 関連: requirements.md §3.1, §3.2, §3.4
 */

import { describe, expect, it } from "vitest";
import { buildDeepResearchPrompt } from "../prompt";
import {
  DEEP_RESEARCH_ITEMS_FLAT,
  CATEGORY_LABELS,
} from "../schema";

const SAMPLE_STORE = {
  name: "サンプル食堂",
  prefecture: "東京都",
  city: "新宿区",
  address: "西新宿 1-1-1",
  genre: "和食",
  site_url: "https://example.com",
} as const;

describe("buildDeepResearchPrompt", () => {
  it("決定性: 同じ入力で同じ文字列", () => {
    const a = buildDeepResearchPrompt({ store: { ...SAMPLE_STORE } });
    const b = buildDeepResearchPrompt({ store: { ...SAMPLE_STORE } });
    expect(a.stage1.systemPrompt).toBe(b.stage1.systemPrompt);
    expect(a.stage1.userPrompt).toBe(b.stage1.userPrompt);
  });

  it("Stage 1 prompt: 全 51 項目キーと A/B/C 凡例を含む", () => {
    const { stage1 } = buildDeepResearchPrompt({
      store: { ...SAMPLE_STORE },
    });
    // 区分凡例
    expect(stage1.systemPrompt).toContain("A (高信頼)");
    expect(stage1.systemPrompt).toContain("B (推定)");
    expect(stage1.systemPrompt).toContain("C (店主ヒアリング必須)");

    // 全項目キーが含まれること
    for (const item of DEEP_RESEARCH_ITEMS_FLAT) {
      expect(stage1.userPrompt).toContain(item.key);
    }

    // 全カテゴリ名が含まれること
    for (const label of Object.values(CATEGORY_LABELS)) {
      expect(stage1.userPrompt).toContain(label);
    }

    // 店舗情報が user prompt に埋め込まれる
    expect(stage1.userPrompt).toContain(SAMPLE_STORE.name);
    expect(stage1.userPrompt).toContain(SAMPLE_STORE.address);
  });

  it("Stage 2 prompt: Stage 1 Markdown を user prompt に埋め込む", () => {
    const prompts = buildDeepResearchPrompt({ store: { ...SAMPLE_STORE } });
    const reportMd = "## 店舗の基本情報\n- 屋号: サンプル食堂";
    const stage2 = prompts.stage2(reportMd);
    expect(stage2.userPrompt).toContain(reportMd);
    expect(stage2.systemPrompt).toContain("category_1_basic");
    expect(stage2.systemPrompt).toContain("hearing_questions");
  });

  // ---------------------------------------------------------------------------
  // 住所二重結合バグの regression guard
  // (lib/places/to-store-input.ts の formattedAddress 正規化と合わせて、
  //  `${prefecture}${city}${address}` 結合時にプレフィックス重複が起きないこと)
  // ---------------------------------------------------------------------------

  // ---------------------------------------------------------------------------
  // 所在地・ジャンルは任意入力 (必須は店舗名のみ)。空欄でも prompt が落ちず、
  // AI に推定を促す不明フォールバックへ degrade すること。
  // ---------------------------------------------------------------------------

  it("所在地・ジャンルが空でも prompt 生成は落ちず不明フォールバックになる", () => {
    const { stage1 } = buildDeepResearchPrompt({
      store: {
        name: "所在地未登録店",
        prefecture: "",
        city: "",
        address: "",
        genre: "",
        site_url: "",
      },
    });

    // 店舗名 (屋号) は常に埋め込まれる
    expect(stage1.userPrompt).toMatch(/屋号: 所在地未登録店/);
    // 空欄は推定を促す不明フォールバックに置き換わる
    expect(stage1.userPrompt).toMatch(/住所: 不明/);
    expect(stage1.userPrompt).toMatch(/料理ジャンル: 不明/);
    // 空文字をそのまま連結した "住所: \n" のような空行を残さない
    expect(stage1.userPrompt).not.toMatch(/住所: *\n/);
  });

  it("所在地が空白文字のみでも .trim() 後に不明フォールバックする", () => {
    const { stage1 } = buildDeepResearchPrompt({
      store: {
        name: "空白所在地店",
        prefecture: "  ",
        city: "  ",
        address: "  ",
        genre: "和食",
        site_url: "",
      },
    });

    expect(stage1.userPrompt).toMatch(/住所: 不明/);
    // 空白だけの住所行 ("住所:   ") を残さない
    expect(stage1.userPrompt).not.toMatch(/住所: +\n/);
  });

  it("住所行は `${prefecture}${city}${address}` で正しく 1 回だけ結合される", () => {
    const { stage1 } = buildDeepResearchPrompt({
      store: {
        name: "ロクシタンカフェ SHIBUYA TOKYO",
        prefecture: "東京都",
        city: "渋谷区",
        address: "道玄坂２丁目３−１ 渋谷駅前ビル 2-3階",
        genre: "カフェ",
        site_url: "",
      },
    });
    const addressLine = stage1.userPrompt.match(/住所: ([^\n]+)/)?.[1] ?? "";
    expect(addressLine).toBe("東京都渋谷区道玄坂２丁目３−１ 渋谷駅前ビル 2-3階");
    expect(addressLine).not.toMatch(/東京都.*東京都/);
    expect(addressLine).not.toMatch(/渋谷区.*渋谷区/);
  });
});
