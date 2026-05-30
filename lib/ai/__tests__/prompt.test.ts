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
import type { FewShotExample } from "@/types/ai-prompt-template";

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

  it("assigned_sales 空文字時は neutral placeholder「担当者」を使用し、prefix 重複が起きない (Issue #18)", () => {
    const { systemPrompt } = buildAnalysisPrompt({
      ...baseInput,
      assignedSales: "",
    });
    // prefix が一回だけ挿入される
    expect(systemPrompt).toMatch(/私ファーストWEBの担当者と申しまして/);
    // 重複した形が含まれない (regression guard for Issue #18)
    expect(systemPrompt).not.toMatch(/ファーストWEBのファーストWEBの/);
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

describe("buildAnalysisPrompt - カスタム fewshots (Issue #42 Phase 3)", () => {
  const customExamples: FewShotExample[] = [
    {
      title: "テスト店舗1",
      store_meta: "東京都渋谷区・イタリアン・パスタ専門",
      call_script_ideal:
        "ランチ中すみません\n私ファーストWEBの{ASSIGNED_SALES}と申しまして\nパスタが美味しいとお聞きしてご連絡しました",
    },
    {
      title: "テスト店舗2",
      store_meta: "大阪府難波・焼肉・黒毛和牛",
      call_script_ideal:
        "ご準備中すみません\n私ファーストWEBの{ASSIGNED_SALES}と申します\n黒毛和牛の焼肉が有名とお聞きしてご連絡しました",
    },
  ];

  it("fewshots 指定時: カスタム店舗情報が systemPrompt に含まれる", () => {
    const { systemPrompt } = buildAnalysisPrompt(baseInput, {
      kind: "fewshots",
      fewshots: customExamples,
    });
    expect(systemPrompt).toMatch(/東京都渋谷区・イタリアン・パスタ専門/);
    expect(systemPrompt).toMatch(/大阪府難波・焼肉・黒毛和牛/);
  });

  it("fewshots 指定時: ハードコード URL(導楽 / 蕎楽亭)が含まれない", () => {
    const { systemPrompt } = buildAnalysisPrompt(baseInput, {
      kind: "fewshots",
      fewshots: customExamples,
    });
    expect(systemPrompt).not.toMatch(/A1405\/A140504\/14096697/);
    expect(systemPrompt).not.toMatch(/A1309\/A130905\/13000479/);
  });

  it("fewshots 指定時: {ASSIGNED_SALES} プレースホルダーが発信者名に置換される", () => {
    const { systemPrompt } = buildAnalysisPrompt(baseInput, {
      kind: "fewshots",
      fewshots: customExamples,
    });
    expect(systemPrompt).toMatch(/私ファーストWEBの渡部と申しまして/);
    expect(systemPrompt).not.toMatch(/\{ASSIGNED_SALES\}/);
  });

  it("template undefined → ハードコード 2 例(導楽 / 蕎楽亭)にフォールバック", () => {
    const { systemPrompt } = buildAnalysisPrompt(baseInput, undefined);
    expect(systemPrompt).toMatch(/A1405\/A140504\/14096697/);
    expect(systemPrompt).toMatch(/A1309\/A130905\/13000479/);
  });

  it("fewshots 空配列 → ハードコード 2 例(導楽 / 蕎楽亭)にフォールバック", () => {
    const { systemPrompt } = buildAnalysisPrompt(baseInput, {
      kind: "fewshots",
      fewshots: [],
    });
    expect(systemPrompt).toMatch(/A1405\/A140504\/14096697/);
    expect(systemPrompt).toMatch(/A1309\/A130905\/13000479/);
  });
});

describe("buildAnalysisPrompt - 自由記述テンプレート (freeform)", () => {
  it("freeform 指定時: 自由記述テキストが systemPrompt に含まれる", () => {
    const text = "落ち着いた丁寧なトーンで分析してください。架電は短めに。";
    const { systemPrompt } = buildAnalysisPrompt(baseInput, {
      kind: "freeform",
      text,
    });
    expect(systemPrompt).toMatch(/落ち着いた丁寧なトーンで分析してください/);
  });

  it("freeform 指定時: ハードコード 2 例(導楽 / 蕎楽亭)で置換され含まれない", () => {
    const { systemPrompt } = buildAnalysisPrompt(baseInput, {
      kind: "freeform",
      text: "自由記述の本文",
    });
    expect(systemPrompt).not.toMatch(/A1405\/A140504\/14096697/);
    expect(systemPrompt).not.toMatch(/A1309\/A130905\/13000479/);
  });

  it("freeform 指定時: {ASSIGNED_SALES} が発信者名に置換される", () => {
    const { systemPrompt } = buildAnalysisPrompt(baseInput, {
      kind: "freeform",
      text: "私ファーストWEBの{ASSIGNED_SALES}と申しまして…という冒頭で。",
    });
    expect(systemPrompt).toMatch(/私ファーストWEBの渡部と申しまして/);
    expect(systemPrompt).not.toMatch(/\{ASSIGNED_SALES\}/);
  });

  it("freeform で text が空文字 → ハードコード 2 例にフォールバック", () => {
    const { systemPrompt } = buildAnalysisPrompt(baseInput, {
      kind: "freeform",
      text: "   ",
    });
    expect(systemPrompt).toMatch(/A1405\/A140504\/14096697/);
    expect(systemPrompt).toMatch(/A1309\/A130905\/13000479/);
  });
});
