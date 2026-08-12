/**
 * buildBasicInfoBlock / buildSalesAssetsPrompt の単体検証 (task 2.3, store-basic-info)
 *
 * 受け入れ基準 (R2.3 / R4.1 / R4.2 / R7.1 / R7.3) と純関数の不変条件を直接検証する。
 */

import { describe, it, expect } from "vitest";
import {
  buildBasicInfoBlock,
  buildSalesAssetsPrompt,
} from "../basic-info-prompt";
import { BASIC_INFO_ITEMS } from "@/lib/domain/basic-info-items";
import type { BasicInfo, BasicInfoField, FillSource } from "@/types/basic-info";

const NOW = "2026-06-08T10:00:00.000Z";

// 実定義から代表キーを抽出 (リファクタ追随性)
const A_KEY = BASIC_INFO_ITEMS.find((i) => i.default_tier === "A")!.key;
const B_KEY = BASIC_INFO_ITEMS.find((i) => i.default_tier === "B")!.key;
const C_KEY = BASIC_INFO_ITEMS.find((i) => i.default_tier === "C")!.key;
const A_KEY_LABEL = BASIC_INFO_ITEMS.find((i) => i.key === A_KEY)!.label;
const B_KEY_LABEL = BASIC_INFO_ITEMS.find((i) => i.key === B_KEY)!.label;

function field(
  value: string | null,
  tier: "A" | "B" | "C" = "A",
  filled_by: FillSource | null = "places",
  extras: Partial<BasicInfoField> = {},
): BasicInfoField {
  return { value, tier, filled_by, updated_at: NOW, ...extras };
}

// ---- buildBasicInfoBlock --------------------------------------------------

describe("buildBasicInfoBlock - 充足項目のみ整形", () => {
  it("tier=A 充足項目を value のみで列挙する", () => {
    const basic: BasicInfo = { [A_KEY]: field("値A") };
    const block = buildBasicInfoBlock(basic);
    expect(block).toContain("## 店舗基本情報(充足項目のみ)");
    expect(block).toContain(`- ${A_KEY_LABEL}: 値A`);
  });

  it("tier=B は確信度・出典・抜粋を併記 (R2.3)", () => {
    const basic: BasicInfo = {
      [B_KEY]: field("推定値", "B", "places", {
        confidence: 75,
        source_urls: ["https://tabelog.com/x", "https://example.com"],
        source_quote: "予算 4000-6000 円",
      }),
    };
    const block = buildBasicInfoBlock(basic);
    expect(block).toContain(`- ${B_KEY_LABEL}: 推定値`);
    expect(block).toContain("確信度 75");
    expect(block).toContain("出典: https://tabelog.com/x / https://example.com");
    expect(block).toContain("抜粋「予算 4000-6000 円」");
  });

  it("value=null の項目は省略", () => {
    const basic: BasicInfo = { [A_KEY]: field(null) };
    const block = buildBasicInfoBlock(basic);
    expect(block).toBe(""); // 全項目未充足 → 空文字
  });

  it("value=空文字/空白のみの項目は省略", () => {
    const basic: BasicInfo = {
      [A_KEY]: field(""),
      [B_KEY]: field("   ", "B"),
    };
    const block = buildBasicInfoBlock(basic);
    expect(block).toBe("");
  });

  it("tier=C の未充足(value=null + hearing_question)は省略", () => {
    const basic: BasicInfo = {
      [C_KEY]: field(null, "C", null, {
        hearing_question: "オペレーション体制を教えてください",
      }),
    };
    const block = buildBasicInfoBlock(basic);
    expect(block).toBe("");
  });

  it("tier=C でも value が充足していれば含まれる", () => {
    const basic: BasicInfo = { [C_KEY]: field("店主回答", "C", "manual") };
    const block = buildBasicInfoBlock(basic);
    expect(block).toContain("店主回答");
  });

  it("充足項目のないカテゴリは見出しごと省略", () => {
    // A_KEY と B_KEY が同カテゴリ category_1_basic の可能性が高いため、
    // 別カテゴリの C_KEY (category_8_other 等) との対比で検証
    const basic: BasicInfo = { [A_KEY]: field("値A") };
    const block = buildBasicInfoBlock(basic);
    // category_8 のラベル「今後の目標・お困り事」は出ない
    expect(block).not.toContain("今後の目標");
    expect(block).not.toContain("最優先課題");
  });

  it("basic_info が空オブジェクトなら空文字列", () => {
    const block = buildBasicInfoBlock({});
    expect(block).toBe("");
  });

  it("未知キー (BASIC_INFO_ITEMS 非定義) は無視", () => {
    const basic: BasicInfo = {
      __unknown_key__: field("ゴミ"),
      [A_KEY]: field("正常"),
    };
    const block = buildBasicInfoBlock(basic);
    expect(block).not.toContain("ゴミ");
    expect(block).toContain("正常");
  });

  it("tier=B のメタが部分的でも欠落分はスキップして出力する", () => {
    const basic: BasicInfo = {
      [B_KEY]: field("推定", "B", "places", { confidence: 60 }),
    };
    const block = buildBasicInfoBlock(basic);
    expect(block).toContain("確信度 60");
    expect(block).not.toContain("出典:");
    expect(block).not.toContain("抜粋");
  });

  it("phone / review を一級市民として出力に含める (#134 リグレッション回帰防止)", () => {
    const basic: BasicInfo = {
      phone: field("03-1234-5678", "A", "places"),
      review_avg: field("4.0", "A", "places"),
      review_count: field("50", "A", "places"),
    };
    const block = buildBasicInfoBlock(basic);
    // #134: これらが落ちると営業資産生成の入力から電話・口コミが消える
    expect(block).toContain("電話番号: 03-1234-5678");
    expect(block).toContain("Google 口コミ評価(平均): 4.0");
    expect(block).toContain("Google 口コミ件数: 50");
  });
});

// ---- buildSalesAssetsPrompt ----------------------------------------------

describe("buildSalesAssetsPrompt - systemPrompt", () => {
  it("役割定義 / 確信度判断基準 / Few-shot 2 例を含む", () => {
    const { systemPrompt } = buildSalesAssetsPrompt({
      basicInfo: {},
      pastedResearchText: "",
      additionalInstructions: "",
      assignedSales: "山田",
    });
    expect(systemPrompt).toContain("飲食店向け WEB 集客の営業支援 AI");
    expect(systemPrompt).toContain("確信度の判断基準");
    expect(systemPrompt).toContain("Few-shot 例 1");
    expect(systemPrompt).toContain("Few-shot 例 2");
  });

  it("assignedSales が空のときは neutral placeholder「担当者」を使う", () => {
    const { systemPrompt } = buildSalesAssetsPrompt({
      basicInfo: {},
      pastedResearchText: "",
      additionalInstructions: "",
      assignedSales: "",
    });
    expect(systemPrompt).toContain("私ファーストWEBの担当者と申しまして");
  });

  it("assignedSales が空白のみでも neutral placeholder を使う", () => {
    const { systemPrompt } = buildSalesAssetsPrompt({
      basicInfo: {},
      pastedResearchText: "",
      additionalInstructions: "",
      assignedSales: "   ",
    });
    expect(systemPrompt).toContain("私ファーストWEBの担当者と申しまして");
  });

  it("assignedSales が指定されればその名前で発信者プレフィクスを構築", () => {
    const { systemPrompt } = buildSalesAssetsPrompt({
      basicInfo: {},
      pastedResearchText: "",
      additionalInstructions: "",
      assignedSales: "山田太郎",
    });
    expect(systemPrompt).toContain("私ファーストWEBの山田太郎と申しまして");
  });

  it("formValues / store フォーム値の語彙が一切出ない (Issue 1 解決, #121)", () => {
    const { systemPrompt } = buildSalesAssetsPrompt({
      basicInfo: {},
      pastedResearchText: "",
      additionalInstructions: "",
      assignedSales: "山田",
    });
    expect(systemPrompt).not.toContain("form values");
    expect(systemPrompt).not.toContain("ページ HTML");
    expect(systemPrompt).not.toContain("Deep Research 調査結果");
  });
});

describe("buildSalesAssetsPrompt - userParts", () => {
  it("basic_info が空のとき: 「現時点で充足された項目はありません」Part を必ず入れる (R7.2)", () => {
    const { userParts } = buildSalesAssetsPrompt({
      basicInfo: {},
      pastedResearchText: "",
      additionalInstructions: "",
      assignedSales: "山田",
    });
    expect(userParts).toHaveLength(1);
    const text = (userParts[0] as { text: string }).text;
    expect(text).toContain("店舗基本情報");
    expect(text).toContain("現時点で充足された項目はありません");
  });

  it("basic_info に充足項目があれば充足のみ Markdown Part を入れる", () => {
    const basic: BasicInfo = { [A_KEY]: field("値A") };
    const { userParts } = buildSalesAssetsPrompt({
      basicInfo: basic,
      pastedResearchText: "",
      additionalInstructions: "",
      assignedSales: "山田",
    });
    const text = (userParts[0] as { text: string }).text;
    expect(text).toContain("## 店舗基本情報(充足項目のみ)");
    expect(text).toContain(`- ${A_KEY_LABEL}: 値A`);
  });

  it("pastedResearchText がある時は別 Part として追加 (R4.1, R4.2 構造化しない)", () => {
    const { userParts } = buildSalesAssetsPrompt({
      basicInfo: {},
      pastedResearchText: "## 調査結果\nオーナーは...という人物。",
      additionalInstructions: "",
      assignedSales: "山田",
    });
    expect(userParts).toHaveLength(2);
    const text = (userParts[1] as { text: string }).text;
    expect(text).toContain("## 調査結果テキスト");
    expect(text).toContain("オーナーは...という人物。");
  });

  it("pastedResearchText が空文字のときは Part を省略 (R4.3 空でも生成可)", () => {
    const { userParts } = buildSalesAssetsPrompt({
      basicInfo: {},
      pastedResearchText: "   ",
      additionalInstructions: "",
      assignedSales: "山田",
    });
    expect(userParts).toHaveLength(1); // 基本情報 Part のみ
  });

  it("additionalInstructions がある時は別 Part として追加", () => {
    const { userParts } = buildSalesAssetsPrompt({
      basicInfo: {},
      pastedResearchText: "",
      additionalInstructions: "電話を平日のみ提案して",
      assignedSales: "山田",
    });
    expect(userParts).toHaveLength(2);
    const text = (userParts[1] as { text: string }).text;
    expect(text).toContain("ユーザー追加指示");
    expect(text).toContain("電話を平日のみ提案して");
  });

  it("basic_info / pastedResearchText / additionalInstructions すべて揃えば 3 Part", () => {
    const basic: BasicInfo = { [A_KEY]: field("値") };
    const { userParts } = buildSalesAssetsPrompt({
      basicInfo: basic,
      pastedResearchText: "調査結果",
      additionalInstructions: "追加指示",
      assignedSales: "山田",
    });
    expect(userParts).toHaveLength(3);
  });
});

describe("buildSalesAssetsPrompt - R7.3 構造化非依存", () => {
  it("structurer / responseJsonSchema 等の構造化呼び出しを含まない", () => {
    const { systemPrompt, userParts } = buildSalesAssetsPrompt({
      basicInfo: {},
      pastedResearchText: "テキスト",
      additionalInstructions: "",
      assignedSales: "山田",
    });
    // システムプロンプトに「JSON Schema」言及はあるが「structurer」「Stage 2」は無い
    expect(systemPrompt).not.toContain("structurer");
    expect(systemPrompt).not.toContain("Stage 2");
    expect(systemPrompt).not.toContain("Stage2");
    for (const part of userParts) {
      const text = (part as { text: string }).text;
      expect(text).not.toContain("structurer");
    }
  });

  it("貼付テキストはそのまま投入され構造化(JSON 化)されない (R4.2)", () => {
    const raw = "## オーナー\n名前: 太郎\n経歴: 修行 10 年\n\nうちの強み:\n- 刺身";
    const { userParts } = buildSalesAssetsPrompt({
      basicInfo: {},
      pastedResearchText: raw,
      additionalInstructions: "",
      assignedSales: "山田",
    });
    const pastedPart = userParts.find((p) =>
      (p as { text: string }).text.includes("## 調査結果テキスト"),
    ) as { text: string } | undefined;
    expect(pastedPart).toBeDefined();
    expect(pastedPart?.text).toContain(raw);
  });
});

describe("buildSalesAssetsPrompt - 純関数", () => {
  it("入力 basicInfo を変更しない", () => {
    const basic: BasicInfo = { [A_KEY]: field("値A") };
    const snapshot = JSON.parse(JSON.stringify(basic)) as BasicInfo;
    buildSalesAssetsPrompt({
      basicInfo: basic,
      pastedResearchText: "",
      additionalInstructions: "",
      assignedSales: "山田",
    });
    expect(basic).toEqual(snapshot);
  });

  it("同一入力で同一出力 (決定性)", () => {
    const input = {
      basicInfo: { [A_KEY]: field("値") },
      pastedResearchText: "テキスト",
      additionalInstructions: "指示",
      assignedSales: "山田",
    };
    const a = buildSalesAssetsPrompt(input);
    const b = buildSalesAssetsPrompt(input);
    expect(a).toEqual(b);
  });
});

/**
 * 役割ラベル付き複数電話番号の consumer 回帰
 * (PR #180 final smoke hardening、Issue B)。
 *
 * `phone` の canonical 値が単一番号から
 * `店舗直通: ... / 予約・問い合わせ(食べログ): ...` の複合文字列になっても、
 * 営業資産生成プロンプトが壊れないことを固定する
 * (`nearest_station` が既に複数サブ情報を1文字列で持つのと同じ扱い)。
 */
describe("buildBasicInfoBlock — 役割ラベル付き電話番号 (Issue B)", () => {
  const field = (value: string) => ({
    value,
    tier: "A" as const,
    filled_by: "manual" as const,
    updated_at: "2026-08-12T00:00:00.000Z",
  });

  it("複数番号の文字列をそのまま1行として出力する", () => {
    const block = buildBasicInfoBlock({
      phone: field("店舗直通: 045-305-6536 / 予約・問い合わせ(食べログ): 050-5869-4190"),
    });
    expect(block).toContain("電話番号: 店舗直通: 045-305-6536 / 予約・問い合わせ(食べログ): 050-5869-4190");
  });

  it("単一番号の従来形式も従来どおり出力する", () => {
    const block = buildBasicInfoBlock({ phone: field("045-305-6536") });
    expect(block).toContain("電話番号: 045-305-6536");
  });

  it("空値は従来どおり省略する", () => {
    const block = buildBasicInfoBlock({ phone: { ...field(""), value: "" } });
    expect(block).not.toContain("電話番号");
  });
});
