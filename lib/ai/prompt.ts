/**
 * AI 分析の system prompt + user message Parts を組立てる純関数。
 *
 * - system prompt: 役割定義 + 出力規約 + 確信度判断基準 + Few-shot 例(カスタム or ハードコード 2 例)
 * - user message Parts: フォーム値 JSON / 取得済 HTML 全文 / 自由追加指示 を別 Part として並べる
 *   - HTML と追加指示は空時に省略
 * - assigned_sales が空文字の場合は neutral placeholder「担当者」に差替(prefix「私ファーストWEBの」はテンプレート側が保持)
 * - fewshots 引数が指定されている場合はカスタム Few-shot を使用し、未指定/空配列の場合はハードコード 2 例にフォールバック
 *
 * 関連: design.md §「PromptBuilder」, requirements.md §2.4, §3.4, §7.1, §7.2
 */

import "server-only";

import type { Part } from "@google/genai";
import type { Store } from "@/types/store";
import type { FewShotExample } from "@/types/ai-prompt-template";

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
`;

/**
 * Few-shot 例 1: 導楽(神奈川県川崎市・居酒屋・海鮮+日本酒)
 * 出典: GitHub Issue #13 ユーザー提供サンプル
 */
const FEW_SHOT_DOURAKU_TEMPLATE = `### Few-shot 例 1
店舗: 食べログ URL https://s.tabelog.com/kanagawa/A1405/A140504/14096697/ (居酒屋・神奈川県川崎市・刺身/日本酒)
発信者名: {ASSIGNED_SALES}

call_script の理想出力:
ご準備中にすみません
私ファーストWEBの{ASSIGNED_SALES}と申しまして

神奈川県川崎市の海鮮や日本酒がいただける居酒屋さん中心にWEBでのご情報発信をお手伝いさせていただいてるのですが、
お手すきであればご代表のオーナー様お願いしたかったのですが〜

(オーナー変わる)
ご準備中すみません
私ファーストWEBの{ASSIGNED_SALES}と申しまして

神奈川県川崎市の海鮮や日本酒がいただける居酒屋さん中心にWEBでのご情報発信をお手伝いさせていただいてるのですが、昨日実際にお食事いただきまして、刺し盛に新鮮なくじらのお刺身が入っていたり、日本酒の種類もかなり多く取り揃えられていて本当に美味しかったのでお電話取らさせていただいたのですが、

よくあるグルメサイト等のご案内ではないんですが、お店の公式の情報を正しく発信することに加えてそれらを包括的にGoogleに認知させるためのお手伝いをしているので

まずは一度弊社の取り組み内容のご説明のご機会をいただきたく事前にお電話取らせていただたんですけれども
ちなみにオーナーさんの方で普段こういうお話だったり業者のご対応にあてられるお時間帯で言うと、比較的14時〜16時ぐらいがご迷惑少ないでしょうか?
`;

/**
 * Few-shot 例 2: 蕎楽亭(東京都・蕎麦・郷土料理)
 * 出典: GitHub Issue #13 ユーザー提供サンプル
 */
const FEW_SHOT_KYOURAKUTEI_TEMPLATE = `### Few-shot 例 2
店舗: 食べログ URL https://s.tabelog.com/tokyo/A1309/A130905/13000479/ (蕎麦・東京都・会津郷土料理)
発信者名: {ASSIGNED_SALES}

call_script の理想出力:
ランチ終わりにすみません
私ファーストWEBの{ASSIGNED_SALES}と申しまして

Googleマップ含めたWEBでのご情報発信をお手伝いさせていただいてるのですが、
お手すきであればご代表のオーナー様お願いしたかったのですが〜

(オーナー変わる)
ご準備中すみません
私ファーストWEBの{ASSIGNED_SALES}と申しまして

Googleマップ含めたWEBでのご情報発信をお手伝いさせていただいてるのですが、
都内のお蕎麦屋さんの中でも、こづゆや馬刺しなどの会津の郷土料理が楽しめると情報拝見してとても気になりお電話取らさせていただいたのですが、

よくあるグルメサイト等のご案内ではないんですが、お店の公式の情報として正しく認知してもらうことに加えてそれらを包括的にGoogleに認知させるためのお手伝いをしているので

まずは一度弊社の取り組み内容のご説明のご機会をいただきたく事前にお電話取らせていただたんですけれども
ちなみにオーナーさんの方で普段こういうお話だったり業者のご対応にあてられるお時間帯で言うと、比較的14時〜16時ぐらいがご迷惑少ないでしょうか?

ヒアリング〜
常連さんの特徴?
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
 * - fewshots 指定時はカスタム例を使用、未指定/空配列はハードコード 2 例にフォールバック
 * - 構造化出力契約はユーザーの追加指示で上書き不可(Req 7.3)
 */
export function buildAnalysisPrompt(
  input: BuildAnalysisPromptInput,
  fewshots?: FewShotExample[],
): BuiltPrompt {
  const sales = input.assignedSales.trim() || NEUTRAL_SALES_PLACEHOLDER;

  let fewshotSection: string;
  if (fewshots && fewshots.length > 0) {
    fewshotSection = formatCustomFewShots(fewshots, sales);
  } else {
    const fewshot1 = FEW_SHOT_DOURAKU_TEMPLATE.replaceAll(
      "{ASSIGNED_SALES}",
      sales,
    );
    const fewshot2 = FEW_SHOT_KYOURAKUTEI_TEMPLATE.replaceAll(
      "{ASSIGNED_SALES}",
      sales,
    );
    fewshotSection = `${fewshot1}\n${fewshot2}`;
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

  // 自由追加指示 Part(空時は省略、構造化出力契約を変えない位置)
  const trimmedInstructions = input.additionalInstructions.trim();
  if (trimmedInstructions.length > 0) {
    userParts.push({
      text: `## ユーザー追加指示 (構造化出力 schema は変えない、call_script の冒頭発信者名も変えない)\n${trimmedInstructions}`,
    });
  }

  return { systemPrompt, userParts };
}
