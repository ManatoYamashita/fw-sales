/**
 * analyzeStoreAction の統合テスト(`@google/genai` SDK をモック化)。
 *
 * 各失敗経路で `ActionResult.failure` の正規化メッセージが返ることを検証する。
 * SDK の生エラーメッセージが client にそのまま漏出していないことも確認する。
 *
 * 関連: design.md §「analyzeStoreAction」, requirements.md §2.3, §2.6, §3.5,
 *       §6.1, §6.3
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// vi.hoisted で mock の参照を提供(vi.mock factory が import より前に評価されるため)
const { mockGenerateContent } = vi.hoisted(() => ({
  mockGenerateContent: vi.fn(),
}));

// class として mock することで `new GoogleGenAI({apiKey})` の instance 化が
// 確実に正しい shape (.models.generateContent) を持つ
vi.mock("@google/genai", () => ({
  GoogleGenAI: class MockGoogleGenAI {
    models = { generateContent: mockGenerateContent };
    constructor(_opts: { apiKey: string }) {
      void _opts;
    }
  },
}));

import { analyzeStoreAction } from "../ai-analysis-actions";
import { _resetRateLimitForTest } from "@/lib/ai/rate-limiter";

const validAnalysis = {
  strengths_markdown: "## 強み\n- 立地が良い",
  weaknesses_markdown: "## 弱み\n- 客単価が低い",
  gourmet_paid_status: "食べログ無料プラン",
  gbp_completeness: "説明欄あり",
  call_script: "ご準備中にすみません、私ファーストWEBの渡部と申します",
  confidence: {
    strengths: 80,
    weaknesses: 70,
    gourmet_paid_status: 60,
    gbp_completeness: 75,
    call_script: 85,
  },
};

function makeFormData(
  overrides: Partial<Record<string, string>> = {},
): FormData {
  const fd = new FormData();
  fd.set("name", "導楽");
  fd.set("prefecture", "神奈川県");
  fd.set("city", "川崎市中原区");
  fd.set("address", "新丸子駅周辺");
  fd.set("genre", "居酒屋");
  fd.set("phone", "");
  fd.set("site_url", "");
  fd.set("instagram_url", "");
  fd.set("map_url", "");
  fd.set("review_avg", "3.4");
  fd.set("review_count", "12");
  fd.set("memo", "");
  fd.set("operator_type", "未設定");
  fd.set("operator_name", "");
  fd.set("htmlContent", "");
  fd.set("additionalInstructions", "");
  fd.set("assignedSales", "渡部");
  fd.set("storeId", "");
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined) continue;
    fd.set(k, v);
  }
  return fd;
}

describe("analyzeStoreAction (Gemini SDK mocked)", () => {
  beforeEach(() => {
    _resetRateLimitForTest();
    mockGenerateContent.mockReset();
    vi.stubEnv("GEMINI_API_KEY", "test-api-key");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    _resetRateLimitForTest();
  });

  it("正常成功: SDK が valid JSON を返すと ok: true で AiAnalysisResult を返す", async () => {
    mockGenerateContent.mockResolvedValueOnce({
      text: JSON.stringify(validAnalysis),
    });
    const result = await analyzeStoreAction(makeFormData());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.call_script).toBe(validAnalysis.call_script);
      expect(result.data.confidence.strengths).toBe(80);
    }
    expect(mockGenerateContent).toHaveBeenCalledTimes(1);
  });

  it("空 name (Req 2.3): SDK 呼出前に failure を返す", async () => {
    const result = await analyzeStoreAction(makeFormData({ name: "" }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/店舗名/);
    }
    expect(mockGenerateContent).not.toHaveBeenCalled();
  });

  it("rate limit (Req 6.3): 同一 storeId 6 回目で failure、SDK は呼ばれない", async () => {
    mockGenerateContent.mockResolvedValue({
      text: JSON.stringify(validAnalysis),
    });
    for (let i = 0; i < 5; i++) {
      const r = await analyzeStoreAction(makeFormData({ storeId: "store_001" }));
      expect(r.ok).toBe(true);
    }
    // 6 回目は rate limit で reject、SDK は 5 回しか呼ばれない
    const sixth = await analyzeStoreAction(makeFormData({ storeId: "store_001" }));
    expect(sixth.ok).toBe(false);
    if (!sixth.ok) {
      expect(sixth.error).toMatch(/制限中/);
    }
    expect(mockGenerateContent).toHaveBeenCalledTimes(5);
  });

  it("schema 違反 (Req 3.5): SDK が confidence 範囲外を返すと failure", async () => {
    mockGenerateContent.mockResolvedValueOnce({
      text: JSON.stringify({
        ...validAnalysis,
        confidence: { ...validAnalysis.confidence, strengths: -1 },
      }),
    });
    const result = await analyzeStoreAction(makeFormData());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/想定外の形式/);
    }
  });

  it("schema 違反 (Req 3.3): call_script 1501 字超で failure", async () => {
    mockGenerateContent.mockResolvedValueOnce({
      text: JSON.stringify({
        ...validAnalysis,
        call_script: "あ".repeat(1501),
      }),
    });
    const result = await analyzeStoreAction(makeFormData());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/想定外の形式/);
    }
  });

  it("不正な JSON: SDK が non-JSON 文字列を返すと failure", async () => {
    mockGenerateContent.mockRejectedValueOnce(
      new SyntaxError("Unexpected token 'i'"),
    );
    const result = await analyzeStoreAction(makeFormData());
    expect(result.ok).toBe(false);
    // SyntaxError が unknown kind に正規化される
  });

  it("auth error (Req 6.1): SDK が 401 を含む Error を throw すると failure", async () => {
    mockGenerateContent.mockRejectedValueOnce(
      new Error("401 unauthorized: invalid API key"),
    );
    const result = await analyzeStoreAction(makeFormData());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/認証/);
    }
  });

  it("rate limit (SDK 側、429): failure に「レートリミット」メッセージ", async () => {
    mockGenerateContent.mockRejectedValueOnce(
      new Error("429 rate limit exceeded"),
    );
    const result = await analyzeStoreAction(makeFormData());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/レートリミット/);
    }
  });

  it("API error 5xx (Req 6.1): failure に status を含むメッセージ", async () => {
    mockGenerateContent.mockRejectedValueOnce(
      new Error("503 Service Unavailable"),
    );
    const result = await analyzeStoreAction(makeFormData());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/503/);
    }
  });

  it("missing_api_key: GEMINI_API_KEY 未設定で failure", async () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    const result = await analyzeStoreAction(makeFormData());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/GEMINI_API_KEY/);
    }
    expect(mockGenerateContent).not.toHaveBeenCalled();
  });

  it("失敗時に form 値や DB 状態は変更されない (failure を返すだけ)", async () => {
    mockGenerateContent.mockRejectedValueOnce(new Error("503 timeout"));
    const fd = makeFormData();
    const fdSnapshot = JSON.stringify([...fd.entries()]);
    const result = await analyzeStoreAction(fd);
    expect(result.ok).toBe(false);
    // Server Action は副作用なし: FormData 自体は immutable view としては変わらない
    expect(JSON.stringify([...fd.entries()])).toBe(fdSnapshot);
  });

  it("正規化エラー: SDK の生メッセージは UI に流出しない", async () => {
    // API キーや internal request ID が混入する可能性のあるメッセージ
    mockGenerateContent.mockRejectedValueOnce(
      new Error("API key 'AIzaSy_secret_value' invalid - request_id=abc123"),
    );
    const result = await analyzeStoreAction(makeFormData());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      // 機密情報が含まれていないこと
      expect(result.error).not.toMatch(/AIzaSy_secret_value/);
      expect(result.error).not.toMatch(/request_id/);
    }
  });
});
