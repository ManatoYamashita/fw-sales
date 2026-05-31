/**
 * Deep Research パイプラインのプロンプト構築 (Stage 1 / Stage 2 兼用)。
 *
 * Stage 1 (Deep Research API): Web リサーチ + Markdown レポート生成を指示
 * Stage 2 (gemini-2.5-flash-lite): Stage 1 の Markdown を 51 項目 JSON に構造化
 *
 * 設計上の判断:
 * - Stage 1 プロンプトは項目キー名と取得難易度区分 (A/B/C) を明示し、各項目について
 *   出典 URL と該当抜粋を必ず併記するよう指示する (R3.3 確保)
 * - Stage 2 プロンプトは Stage 1 の Markdown を入力に、51 項目 JSON の構造で出力させる
 *   `responseJsonSchema` 強制を併用するため指示は要点のみ短く
 * - 純関数。決定性のため Few-shot は含めずシンプルに保つ (51 項目を網羅するため Few-shot は
 *   逆にプロンプトを肥大化させる懸念があった)
 *
 * 関連: design.md §Components and Interfaces / DeepResearchClient + Structurer,
 *       requirements.md §3.1, §3.2, §3.4
 */

import "server-only";

import type { Store } from "@/types/store";
import {
  CATEGORY_LABELS,
  DEEP_RESEARCH_ITEMS,
  type CategoryKey,
} from "./schema";

export interface BuildDeepResearchPromptInput {
  store: Pick<
    Store,
    "name" | "prefecture" | "city" | "address" | "genre" | "site_url"
  >;
}

export interface DeepResearchPrompts {
  /** Stage 1 (Deep Research) に投げる system + user prompt */
  stage1: { systemPrompt: string; userPrompt: string };
  /**
   * Stage 2 (gemini-2.5-flash-lite) 構造化用 system + user prompt。
   * `concise=true` (再試行時) は簡潔出力プロンプトを返し JSON 切断の再発を抑える。
   */
  stage2: (
    reportMarkdown: string,
    concise?: boolean,
  ) => {
    systemPrompt: string;
    userPrompt: string;
  };
}

/**
 * Deep Research 用のプロンプト一式を生成する。
 *
 * - 同じ店舗入力に対して常に同じ文字列を返す決定的関数
 * - 51 項目のキー名・ラベル・default tier を `DEEP_RESEARCH_ITEMS` から動的に展開する
 *   (項目変更時は schema.ts の定数だけ更新すればプロンプトも追随する)
 */
export function buildDeepResearchPrompt(
  input: BuildDeepResearchPromptInput,
): DeepResearchPrompts {
  const { store } = input;

  // 店舗名以外は任意入力。空欄でも Deep Research AI が公開情報から補完できるよう、
  // 欠落項目は推定を促す不明フォールバックに置き換える (site_url と同じ方式)。
  const location = `${store.prefecture}${store.city}${store.address}`.trim();
  const storeBlock = [
    `屋号: ${store.name}`,
    location ? `住所: ${location}` : "住所: 不明 (公開情報から推定してください)",
    store.genre
      ? `料理ジャンル: ${store.genre}`
      : "料理ジャンル: 不明 (公開情報から推定してください)",
    store.site_url ? `公式サイト: ${store.site_url}` : "公式サイト: 不明",
  ].join("\n");

  return {
    stage1: {
      systemPrompt: buildStage1SystemPrompt(),
      userPrompt: buildStage1UserPrompt(storeBlock),
    },
    stage2: (reportMarkdown, concise = false) => ({
      systemPrompt: buildStage2SystemPrompt(concise),
      userPrompt: buildStage2UserPrompt(storeBlock, reportMarkdown),
    }),
  };
}

// ---------------------------------------------------------------------------
// Stage 1 (Deep Research) プロンプト
// ---------------------------------------------------------------------------

function buildStage1SystemPrompt(): string {
  return [
    "あなたは飲食店の営業準備リサーチに従事する Web リサーチアシスタントです。",
    "対象店舗について 8 カテゴリ・51 項目の調査レポートを Markdown 形式で作成します。",
    "",
    "## 取得難易度区分",
    "- A (高信頼): Web 検索や公式情報源から確実に取得可能",
    "- B (推定): 断片情報からの推測。confidence 0-100 と出典 URL・該当抜粋を必須で併記",
    "- C (店主ヒアリング必須): パブリックデータでは到達不能。営業マンが店主に確認する質問文 (hearing_question) を生成",
    "",
    "## 出力規約",
    "- 各カテゴリは ## 見出しで開始、各項目は ### 見出し",
    "- 各項目の本文では、tier (A/B/C)、value (取得値)、必要に応じて confidence・source_urls (リスト)・source_quote・hearing_question を明示",
    "- 取得不能な項目は空欄にせず、tier=C 相当として hearing_question を必ず添える",
    "- 引用元 URL は信頼できる公開情報のみ。食べログ等のスクレイピング禁止サイトは検索結果のスニペット利用に留めること",
  ].join("\n");
}

function buildStage1UserPrompt(storeBlock: string): string {
  const itemsBlock = renderItemsBlockForPrompt();
  return [
    "対象店舗:",
    storeBlock,
    "",
    "上記店舗について、以下の 8 カテゴリ・51 項目を網羅した Markdown レポートを作成してください。",
    "",
    itemsBlock,
  ].join("\n");
}

function renderItemsBlockForPrompt(): string {
  const lines: string[] = [];
  for (const category of Object.keys(DEEP_RESEARCH_ITEMS) as CategoryKey[]) {
    lines.push(`## ${CATEGORY_LABELS[category]} (${category})`);
    for (const item of DEEP_RESEARCH_ITEMS[category]) {
      lines.push(
        `- key=${item.key} / label=${item.label} / default_tier=${item.default_tier}`,
      );
    }
    lines.push("");
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Stage 2 (gemini-2.5-flash-lite) プロンプト
// ---------------------------------------------------------------------------

function buildStage2SystemPrompt(concise = false): string {
  const lines = [
    "Stage 1 で生成された Markdown レポートを、定義済 JSON Schema に従って構造化してください。",
    "",
    "## 構造化規則",
    "- 各カテゴリ列 (category_1_basic..category_8_other) は当該カテゴリの全項目を配列で出力",
    "- 各項目は key/label/tier/value および tier に応じた付加フィールド (confidence/source_urls/source_quote/hearing_question) を含む",
    "- tier=B: confidence (0-100)、source_urls (配列)、source_quote (抜粋) を必須",
    "- tier=C: hearing_question を必須、value は null 可",
    "- hearing_questions 配列には全 C 項目を {category, question} 形式で抽出",
    "- all_source_urls には Stage 1 が引用した URL を重複排除して配列化",
  ];
  if (concise) {
    // 再試行時: 前回の出力が maxOutputTokens 超過で途中切断され invalid_json に
    // なったケースの再発防止。説明文を排し、各フィールドを短くするよう指示する。
    lines.push(
      "",
      "## 重要 (再試行)",
      "- 前回の出力は不完全な JSON でした。JSON 以外のテキスト (説明文・コードフェンス) を一切付けず、JSON Schema に厳密準拠した完結した JSON のみを出力すること",
      "- source_quote は要点のみ簡潔に (各 1 文以内)。value も冗長な装飾を避ける",
    );
  }
  return lines.join("\n");
}

function buildStage2UserPrompt(
  storeBlock: string,
  reportMarkdown: string,
): string {
  return [
    "対象店舗:",
    storeBlock,
    "",
    "Stage 1 レポート (Markdown):",
    "```markdown",
    reportMarkdown,
    "```",
    "",
    "上記レポートを JSON Schema に従って構造化してください。",
  ].join("\n");
}
