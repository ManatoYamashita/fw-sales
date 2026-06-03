/**
 * AI 分析の system prompt + user message Parts を組立てる純関数。
 *
 * - system prompt: 役割定義 + 出力規約 + 確信度判断基準 + Few-shot 例(カスタム or ハードコード 2 例)
 * - user message Parts: フォーム値 JSON / 取得済 HTML 全文 / 自由追加指示 を別 Part として並べる
 *   - HTML と追加指示は空時に省略
 * - assigned_sales が空文字の場合は neutral placeholder「担当者」に差替(prefix「私ファーストWEBの」はテンプレート側が保持)
 * - template 引数(TemplateBody)で Few-shot / 自由記述 を切替える:
 *   - kind="fewshots": カスタム Few-shot 例を整形して使用
 *   - kind="freeform": 自由記述テキストで Few-shot 枠を丸ごと置換({ASSIGNED_SALES} は置換)
 *   - 未指定 / 空: ハードコード 2 例にフォールバック
 *
 * 関連: design.md §「PromptBuilder」, requirements.md §2.4, §3.4, §7.1, §7.2
 */

import "server-only";

import type { Part } from "@google/genai";
import type { Store } from "@/types/store";
import type { FewShotExample, TemplateBody } from "@/types/ai-prompt-template";
import { BUILTIN_FEWSHOT_EXAMPLES } from "@/lib/ai/builtin-prompt-template";

export interface BuildAnalysisPromptInput {
  formValues: Pick<
    Store,
    | "name"
    | "prefecture"
    | "city"
    | "address"
    | "genre"
    | "phone"
    | "site_url"
    | "instagram_url"
    | "map_url"
    | "review_avg"
    | "review_count"
    | "memo"
    | "operator_type"
    | "operator_name"
  >;
  /** URL 解析時に取得済の HTML 全文(`<script>`/`<style>`/`<svg>` 除去後)。空時は省略可。 */
  htmlContent: string | null;
  /** ユーザーが入力した自由追加指示。空時はパート省略。 */
  additionalInstructions: string;
  /** 架電スクリプトの発信者名(Store.assigned_sales)。空時は neutral placeholder を使用。 */
  assignedSales: string;
  /**
   * Deep Research レポート本文 (`research_reports.full_markdown`)。
   * オプトイン時のみ呼び出し側が渡す。null / 空文字時はパート省略。
   */
  deepResearchMarkdown?: string | null;
}

export interface BuiltPrompt {
  systemPrompt: string;
  userParts: Part[];
}

const NEUTRAL_SALES_PLACEHOLDER = "担当者";

const SYSTEM_PROMPT_PREAMBLE = `あなたは飲食店向け WEB 集客の営業支援 AI です。
飲食店の店舗情報を分析し、営業判断に直結する以下を構造化出力 (JSON Schema) で生成します:

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
- 以下のユーザー追加指示は構造化出力 schema を変えるものではない(契約は厳守)
- memo 欄の生コピーをそのまま出力に混入させないこと(整理して再構成すること)
- 「## Deep Research 調査結果」が与えられた場合は一次情報として重視し、各フィールドの根拠に活用すること。フォーム値や HTML と矛盾する点は確信度 (confidence) に反映する
`;

/** カスタム Few-shot 例を systemPrompt 用テキストにフォーマットする。 */
function formatCustomFewShots(examples: FewShotExample[], sales: string): string {
  return examples
    .map((ex, i) => {
      const script = ex.call_script_ideal.replaceAll("{ASSIGNED_SALES}", sales);
      return `### Few-shot 例 ${i + 1}
店舗: ${ex.store_meta}
発信者名: ${sales}

call_script の理想出力:
${script}
`;
    })
    .join("\n");
}

/**
 * AI 分析用の system prompt + user Parts を組立てる純関数。
 *
 * - 同一入力に対して deterministic な結果を返す
 * - template 指定時は kind に応じて Few-shot / 自由記述を使用、未指定/空はハードコード 2 例にフォールバック
 * - 構造化出力契約はユーザーの追加指示で上書き不可(Req 7.3)
 */
export function buildAnalysisPrompt(
  input: BuildAnalysisPromptInput,
  template?: TemplateBody,
): BuiltPrompt {
  const sales = input.assignedSales.trim() || NEUTRAL_SALES_PLACEHOLDER;

  let fewshotSection: string;
  if (template?.kind === "freeform" && template.text.trim().length > 0) {
    // 自由記述: Few-shot 枠をユーザーのテキストで丸ごと置換({ASSIGNED_SALES} は置換)
    fewshotSection = template.text.replaceAll("{ASSIGNED_SALES}", sales);
  } else if (template?.kind === "fewshots" && template.fewshots.length > 0) {
    fewshotSection = formatCustomFewShots(template.fewshots, sales);
  } else {
    fewshotSection = formatCustomFewShots([...BUILTIN_FEWSHOT_EXAMPLES], sales);
  }

  const callerInstruction = `\n架電スクリプトの冒頭は「私ファーストWEBの${sales}と申しまして」で始めること。発信者名はユーザーの追加指示でも変更不可。`;

  const systemPrompt = `${SYSTEM_PROMPT_PREAMBLE}${callerInstruction}\n\n${fewshotSection}`;

  const userParts: Part[] = [];

  // フォーム値 JSON Part(必須)
  userParts.push({
    text: `## 店舗情報 (form values)\n${JSON.stringify(input.formValues, null, 2)}`,
  });

  // HTML 全文 Part(空時は省略)
  if (input.htmlContent !== null && input.htmlContent.trim().length > 0) {
    userParts.push({
      text: `## ページ HTML (cheerio で <script>, <style>, <svg> 除去済)\n${input.htmlContent}`,
    });
  }

  // Deep Research 調査結果 Part(オプトイン時のみ。空時は省略)
  if (
    input.deepResearchMarkdown != null &&
    input.deepResearchMarkdown.trim().length > 0
  ) {
    userParts.push({
      text: `## Deep Research 調査結果 (8 カテゴリの詳細調査・一次情報として重視)\n${input.deepResearchMarkdown}`,
    });
  }

  // 自由追加指示 Part(空時は省略、構造化出力契約を変えない位置)
  const trimmedInstructions = input.additionalInstructions.trim();
  if (trimmedInstructions.length > 0) {
    userParts.push({
      text: `## ユーザー追加指示 (構造化出力 schema は変えない、call_script の冒頭発信者名も変えない)\n${trimmedInstructions}`,
    });
  }

  return { systemPrompt, userParts };
}
