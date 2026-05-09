/**
 * buildAnalysisPrompt のテスト。
 *
 * 関連: design.md §「PromptBuilder」, requirements.md §2.4, §3.4, §7.1, §7.2
 */
import { describe, expect, it } from "vitest";
import {
  buildAnalysisPrompt,
  type BuildAnalysisPromptInput,
} from "../prompt";

const baseFormValues: BuildAnalysisPromptInput["formValues"] = {
  name: "導楽",
  prefecture: "神奈川県",
  city: "川崎市中原区",
  address: "新丸子駅周辺",
  genre: "居酒屋",
  phone: "",
  site_url: "",
  instagram_url: "",
  map_url: "https://maps.google.com/?q=導楽",
  review_avg: 3.4,
  review_count: 12,
  memo: "テストメモ",
  operator_type: "未設定",
  operator_name: "",
};

const baseInput: BuildAnalysisPromptInput = {
  formValues: baseFormValues,
  htmlContent: null,
  additionalInstructions: "",
  assignedSales: "渡部",
};

describe("buildAnalysisPrompt", () => {
  it("systemPrompt に Few-shot 2 例(導楽 / 蕎楽亭)が含まれる (Req 3.4)", () => {
    const { systemPrompt } = buildAnalysisPrompt(baseInput);
    expect(systemPrompt).toMatch(/Few-shot 例 1/);
    expect(systemPrompt).toMatch(/Few-shot 例 2/);
    expect(systemPrompt).toMatch(/A1405\/A140504\/14096697/); // 導楽 URL
    expect(systemPrompt).toMatch(/A1309\/A130905\/13000479/); // 蕎楽亭 URL
  });

  it("systemPrompt に確信度の判断基準 (90-100/70-89/...) が含まれる", () => {
    const { systemPrompt } = buildAnalysisPrompt(baseInput);
    expect(systemPrompt).toMatch(/90-100/);
    expect(systemPrompt).toMatch(/70-89/);
    expect(systemPrompt).toMatch(/50-69/);
    expect(systemPrompt).toMatch(/0-49/);
  });

  it("assigned_sales 非空時は Few-shot 内に発信者名が差し込まれる", () => {
    const { systemPrompt } = buildAnalysisPrompt(baseInput);
    // "渡部" が Few-shot 例の本文 ("私ファーストWEBの渡部と申しまして") に含まれる
    expect(systemPrompt).toMatch(/私ファーストWEBの渡部と申しまして/);
  });

  it("assigned_sales 空文字時は neutral placeholder「ファーストWEBの担当者」を使用", () => {
    const { systemPrompt } = buildAnalysisPrompt({
      ...baseInput,
      assignedSales: "",
    });
    expect(systemPrompt).toMatch(/ファーストWEBの担当者/);
    // "渡部" や他の固有名は含まれない
    expect(systemPrompt).not.toMatch(/私ファーストWEBの渡部/);
  });

  it("userParts: フォーム値 JSON Part が常に含まれる", () => {
    const { userParts } = buildAnalysisPrompt(baseInput);
    expect(userParts.length).toBeGreaterThanOrEqual(1);
    const formPart = userParts.find((p) => p.text?.includes("店舗情報"));
    expect(formPart).toBeDefined();
    expect(formPart?.text).toMatch(/"name": "導楽"/);
  });

  it("userParts: htmlContent が null なら HTML Part は省略 (Req 2.4)", () => {
    const { userParts } = buildAnalysisPrompt({
      ...baseInput,
      htmlContent: null,
    });
    const htmlPart = userParts.find((p) => p.text?.includes("ページ HTML"));
    expect(htmlPart).toBeUndefined();
  });

  it("userParts: htmlContent が非空なら HTML Part が含まれる", () => {
    const { userParts } = buildAnalysisPrompt({
      ...baseInput,
      htmlContent: "<html><body>テスト</body></html>",
    });
    const htmlPart = userParts.find((p) => p.text?.includes("ページ HTML"));
    expect(htmlPart).toBeDefined();
    expect(htmlPart?.text).toMatch(/テスト/);
  });

  it("userParts: additionalInstructions 空文字時は Part 省略 (Req 7.2)", () => {
    const { userParts } = buildAnalysisPrompt({
      ...baseInput,
      additionalInstructions: "",
    });
    const instructionsPart = userParts.find((p) =>
      p.text?.includes("ユーザー追加指示"),
    );
    expect(instructionsPart).toBeUndefined();
  });

  it("userParts: additionalInstructions 非空時は Part 末尾に追加 (Req 7.1)", () => {
    const instructions = "コスパ不満を重点的に";
    const { userParts } = buildAnalysisPrompt({
      ...baseInput,
      additionalInstructions: instructions,
    });
    const instructionsPart = userParts.find((p) =>
      p.text?.includes("ユーザー追加指示"),
    );
    expect(instructionsPart).toBeDefined();
    expect(instructionsPart?.text).toMatch(new RegExp(instructions));
  });

  it("同一入力で deterministic な systemPrompt + userParts を返す", () => {
    const a = buildAnalysisPrompt(baseInput);
    const b = buildAnalysisPrompt(baseInput);
    expect(a.systemPrompt).toBe(b.systemPrompt);
    expect(a.userParts).toEqual(b.userParts);
  });

  it("systemPrompt に「構造化出力 schema は変えない」が明示されている (Req 7.3)", () => {
    const { systemPrompt } = buildAnalysisPrompt(baseInput);
    expect(systemPrompt).toMatch(/構造化出力\s*schema\s*を変えるものではない/);
  });

  it("call_script の冒頭発信者名指示が systemPrompt に含まれる (Req 3.4)", () => {
    const { systemPrompt } = buildAnalysisPrompt(baseInput);
    expect(systemPrompt).toMatch(/私ファーストWEBの渡部と申しまして.*で始めること/);
  });
});
