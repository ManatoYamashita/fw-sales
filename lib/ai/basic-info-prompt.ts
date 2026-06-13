/**
 * 営業資産生成 (強み・弱み・架電) 用のプロンプト構築 (store-basic-info / Issue #114, #121)
 *
 * design Issue 1 解決: 既存 `buildAnalysisPrompt` (`lib/ai/prompt.ts`) は `formValues`
 * (Store のスカラー部分集合) に依存していたが、本ファイルは `basic_info`(充足項目のみの
 * Markdown 整形) と貼付調査テキスト(構造化しない自由形式) を別 user Part として投入する
 * 純関数を提供する。`formValues` 依存を断ち、構造化処理 (`structurer`) を一切呼ばない (#121)。
 *
 * 関連:
 * - design.md §AI / buildBasicInfoBlock / buildSalesAssetsPrompt
 * - requirements.md §2.3 §4.1 §4.2 §7.1 §7.3
 * - `lib/ai/prompt.ts` の `buildAnalysisPrompt` の役割定義を参考に、basic_info 前提に
 *   書き換えた独自 system preamble を持つ。Few-shot 例は既存 `BUILTIN_FEWSHOT_EXAMPLES`
 *   を共有して文体一貫性を保つ。
 */

import "server-only";

import type { Part } from "@google/genai";
import { BUILTIN_FEWSHOT_EXAMPLES } from "@/lib/ai/builtin-prompt-template";
import {
  BASIC_INFO_ITEM_BY_KEY,
  CATEGORY_LABELS,
  type CategoryKey,
} from "@/lib/domain/basic-info-items";
import type { BasicInfo } from "@/types/basic-info";

const NEUTRAL_SALES_PLACEHOLDER = "担当者";

/**
 * basic_info を主入力とする生成系の system preamble (#121 整合)。
 *
 * 旧 `buildAnalysisPrompt` の formValues 前提文言を排し、basic_info の充足/未充足を
 * 前提とした指示に書き換えている。出力契約 (AiAnalysisSchema) は据置 (#113)。
 */
const SYSTEM_PROMPT_PREAMBLE = `あなたは飲食店向け WEB 集客の営業支援 AI です。
飲食店の店舗基本情報(充足分)と任意の調査結果テキストを分析し、営業判断に直結する以下を構造化出力 (JSON Schema) で生成します:

- strengths_markdown: 店舗の強み (Markdown 形式、見出しは ## まで、箇条書きは - を使用、合計 300〜600 字)
- weaknesses_markdown: 店舗の弱み (Markdown 形式、同上の規約)
- gourmet_paid_status: グルメサイト課金状況 (プレーンテキスト 1〜3 行、食べログ 050 番号判定等)
- gbp_completeness: GBP (Google ビジネスプロフィール) 充実度 (プレーンテキスト、説明欄/口コミ返信/メニュー/最近の写真の有無を箇条書き)
- call_script: 架電スクリプト (プレーンテキスト 1500 字以内、後述の Few-shot 2 例の文体を踏襲)
- confidence: 各フィールド (strengths / weaknesses / gourmet_paid_status / gbp_completeness / call_script) に 0-100 の整数 確信度

確信度の判断基準:
- 90-100: 公式情報や食べログ口コミで直接確認できる
- 70-89: 複数の情報源から推測可能
- 50-69: 単一情報源 + 一般論からの推測
- 0-49: 推測の域、要確認

出力規約:
- レスポンスは JSON Schema (responseJsonSchema) に厳密に従うこと。追加プロパティ・型違反は禁止。
- strengths_markdown / weaknesses_markdown では Markdown 記法を使用してよい(見出し ## / 箇条書き -)
- call_script / gourmet_paid_status / gbp_completeness は Markdown 禁止、プレーンテキストのみ
- call_script は 1500 文字以内、改行は \\n を使用、冒頭は発信者名を差し込んだ自己紹介で開始
- 「店舗基本情報」は充足された項目のみ列挙されている。未充足項目は推測しすぎず、不明な点は確信度を低く設定すること
- 「調査結果テキスト」が与えられた場合は一次情報として重視し、各フィールドの根拠に活用すること。基本情報と矛盾する点は確信度に反映する
- ユーザー追加指示は構造化出力 schema を変えるものではない(契約は厳守)
`;

/** Few-shot 例を system prompt 用にフォーマットする (BUILTIN_FEWSHOT_EXAMPLES を共有)。 */
function formatFewShots(sales: string): string {
  return BUILTIN_FEWSHOT_EXAMPLES.map((ex, i) => {
    const script = ex.call_script_ideal.replaceAll("{ASSIGNED_SALES}", sales);
    return `### Few-shot 例 ${i + 1}
店舗: ${ex.store_meta}
発信者名: ${sales}

call_script の理想出力:
${script}
`;
  }).join("\n");
}

/** value が未充足 (null / 空文字 / 空白のみ) と判定する。 */
function isFieldEmpty(value: string | null): boolean {
  if (value === null) return true;
  if (typeof value === "string" && value.trim() === "") return true;
  return false;
}

/**
 * 充足済み `basic_info` をカテゴリ見出し付き Markdown に整形する純関数。
 *
 * - value が null / 空 (空文字 / 空白のみ) の項目は省略 (R2.5 未充足は根拠に使わない)
 * - tier=C の未充足項目 (hearing_question のみ持つ) も省略
 * - tier=B は確信度・出典 URL・出典抜粋を併記 (R2.3)
 * - 充足項目のないカテゴリは見出しごと省略
 * - 全項目が未充足なら空文字列を返す
 * - 未知キーは無視 (BASIC_INFO_ITEMS が単一の真実)
 *
 * 出力例:
 * ```
 * ## 店舗基本情報(充足項目のみ)
 * ### 店舗の基本情報・特徴
 * - 屋号: 蕎楽亭
 * - 客単価(夜): 5000 円 (確信度 70 / 出典: https://... / 抜粋「ディナー予算 4000-6000」)
 * ```
 */
export function buildBasicInfoBlock(basicInfo: BasicInfo): string {
  const buckets: Record<CategoryKey, string[]> = {
    category_1_basic: [],
    category_2_owner: [],
    category_3_menu: [],
    category_4_customer: [],
    category_5_marketing: [],
    category_6_competitor: [],
    category_7_owned_media: [],
    category_8_other: [],
  };

  for (const [key, field] of Object.entries(basicInfo)) {
    if (!field) continue;
    const def = BASIC_INFO_ITEM_BY_KEY.get(key);
    if (!def) continue; // 未知キーは無視
    if (isFieldEmpty(field.value)) continue;

    let line = `- ${def.label}: ${field.value}`;
    if (field.tier === "B") {
      const meta: string[] = [];
      if (typeof field.confidence === "number") {
        meta.push(`確信度 ${field.confidence}`);
      }
      if (field.source_urls && field.source_urls.length > 0) {
        meta.push(`出典: ${field.source_urls.join(" / ")}`);
      }
      if (
        typeof field.source_quote === "string" &&
        field.source_quote.trim() !== ""
      ) {
        meta.push(`抜粋「${field.source_quote.trim()}」`);
      }
      if (meta.length > 0) {
        line += ` (${meta.join(" / ")})`;
      }
    }
    buckets[def.category].push(line);
  }

  const sections: string[] = [];
  for (const category of Object.keys(buckets) as CategoryKey[]) {
    const lines = buckets[category];
    if (lines.length === 0) continue;
    sections.push(`### ${CATEGORY_LABELS[category]}\n${lines.join("\n")}`);
  }

  if (sections.length === 0) return "";
  return `## 店舗基本情報(充足項目のみ)\n${sections.join("\n\n")}`;
}

// ---- 営業資産生成プロンプト ----------------------------------------------

export interface BuildSalesAssetsInput {
  /** 店舗の現在の `basic_info`(充足項目のみが Markdown 化される)。 */
  basicInfo: BasicInfo;
  /** 貼付調査テキスト(自由形式・構造化しない)。空時は当該 Part を省略。 */
  pastedResearchText: string;
  /** ユーザー追加指示。空時は当該 Part を省略。 */
  additionalInstructions: string;
  /** 架電スクリプトの発信者名。空時は neutral placeholder「担当者」に差替。 */
  assignedSales: string;
}

export interface BuiltSalesAssetsPrompt {
  systemPrompt: string;
  userParts: Part[];
}

/**
 * 営業資産生成 Gemini 呼出用の system + user Parts を組立てる純関数 (Issue 1 解決, #121)。
 *
 * - `formValues` 依存を断つ: 入力は `basicInfo` + `pastedResearchText` のみ。
 * - 構造化処理 (`structurer`) を一切呼ばず参照もしない。貼付テキストは自由形式のまま投入。
 * - basic_info block / 貼付テキスト / 追加指示 を**別の user Part** として並べる
 *   (1 つに混ぜず、Gemini が役割を識別しやすくする)。
 * - basic_info が完全未充足(店舗名のみ登録段階)でも生成は実行可能(R7.2): 空充足を
 *   明示する Part を送る。
 *
 * 出力契約 `AiAnalysisResult` (#113) は据置。
 */
export function buildSalesAssetsPrompt(
  input: BuildSalesAssetsInput,
): BuiltSalesAssetsPrompt {
  const sales = input.assignedSales.trim() || NEUTRAL_SALES_PLACEHOLDER;
  const fewshotSection = formatFewShots(sales);
  const callerInstruction = `\n架電スクリプトの冒頭は「私ファーストWEBの${sales}と申しまして」で始めること。発信者名はユーザーの追加指示でも変更不可。`;

  const systemPrompt = `${SYSTEM_PROMPT_PREAMBLE}${callerInstruction}\n\n${fewshotSection}`;

  const userParts: Part[] = [];

  // 基本情報 Part: 充足項目のみ整形。完全未充足時は明示テキストで Part 保持(R7.2)。
  const basicInfoBlock = buildBasicInfoBlock(input.basicInfo);
  if (basicInfoBlock !== "") {
    userParts.push({ text: basicInfoBlock });
  } else {
    userParts.push({
      text: "## 店舗基本情報\n(現時点で充足された項目はありません。店舗名のみで生成しています。)",
    });
  }

  // 調査結果テキスト Part(空時は省略、構造化しない: R4.2)
  const trimmedPasted = input.pastedResearchText.trim();
  if (trimmedPasted.length > 0) {
    userParts.push({
      text: `## 調査結果テキスト(自由形式・一次情報として重視)\n${trimmedPasted}`,
    });
  }

  // 追加指示 Part(空時は省略、契約は変えない位置)
  const trimmedInstructions = input.additionalInstructions.trim();
  if (trimmedInstructions.length > 0) {
    userParts.push({
      text: `## ユーザー追加指示 (構造化出力 schema は変えない、call_script の冒頭発信者名も変えない)\n${trimmedInstructions}`,
    });
  }

  return { systemPrompt, userParts };
}
