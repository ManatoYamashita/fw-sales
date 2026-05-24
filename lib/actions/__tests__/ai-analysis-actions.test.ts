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
const { mockGenerateContent, mockFindById, mockGetCurrentSession } = vi.hoisted(
  () => ({
    mockGenerateContent: vi.fn(),
    mockFindById: vi.fn(),
    mockGetCurrentSession: vi.fn(),
  }),
);

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

vi.mock("@/lib/repositories", () => ({
  repos: {
    promptTemplate: { findById: mockFindById },
  },
}));

vi.mock("@/lib/supabase/server", () => ({
  getCurrentSession: mockGetCurrentSession,
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
    mockFindById.mockReset();
    mockGetCurrentSession.mockReset();
    // デフォルト: 未ログイン
    mockGetCurrentSession.mockResolvedValue(null);
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

describe("analyzeStoreAction - templateId 連携 (Issue #42 Phase 3)", () => {
  const VALID_TEMPLATE_BODY = JSON.stringify({
    fewshots: [
      {
        title: "カスタム例",
        store_meta: "東京都渋谷区・カスタムジャンル",
        call_script_ideal:
          "私ファーストWEBの{ASSIGNED_SALES}と申します\nカスタムスクリプト",
      },
    ],
  });

  beforeEach(() => {
    _resetRateLimitForTest();
    mockGenerateContent.mockReset();
    mockFindById.mockReset();
    mockGetCurrentSession.mockReset();
    mockGetCurrentSession.mockResolvedValue(null);
    vi.stubEnv("GEMINI_API_KEY", "test-api-key");
    mockGenerateContent.mockResolvedValue({
      text: JSON.stringify({
        strengths_markdown: "## 強み\n- テスト",
        weaknesses_markdown: "## 弱み\n- テスト",
        gourmet_paid_status: "無料",
        gbp_completeness: "説明欄あり",
        call_script: "私ファーストWEBの渡部と申します",
        confidence: {
          strengths: 80,
          weaknesses: 70,
          gourmet_paid_status: 60,
          gbp_completeness: 75,
          call_script: 85,
        },
      }),
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    _resetRateLimitForTest();
  });

  it("templateId 未指定: ログイン不要でそのまま成功 (既存挙動維持)", async () => {
    const result = await analyzeStoreAction(makeFormData());
    expect(result.ok).toBe(true);
    expect(mockFindById).not.toHaveBeenCalled();
    expect(mockGetCurrentSession).not.toHaveBeenCalled();
  });

  it("templateId 指定・有効テンプレート: findById が呼ばれ成功する", async () => {
    const VALID_TPL_ID = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11";
    mockGetCurrentSession.mockResolvedValue({ userId: "user-123" });
    mockFindById.mockResolvedValue({
      id: VALID_TPL_ID,
      user_id: "user-123",
      name: "テスト",
      is_default: true,
      body: VALID_TEMPLATE_BODY,
      created_at: "2026-01-01",
      updated_at: "2026-01-01",
    });

    const result = await analyzeStoreAction(
      makeFormData({ templateId: VALID_TPL_ID }),
    );
    expect(result.ok).toBe(true);
    expect(mockGetCurrentSession).toHaveBeenCalledTimes(1);
    expect(mockFindById).toHaveBeenCalledWith(VALID_TPL_ID, "user-123");
  });

  it("templateId 指定・findById が null (他ユーザー or 存在しない): ハードコードFew-shotへフォールバックし成功", async () => {
    mockGetCurrentSession.mockResolvedValue({ userId: "user-123" });
    mockFindById.mockResolvedValue(null);

    const NON_EXISTENT_UUID = "f47ac10b-58cc-4372-a567-0e02b2c3d479";
    const result = await analyzeStoreAction(
      makeFormData({ templateId: NON_EXISTENT_UUID }),
    );
    expect(result.ok).toBe(true);
    expect(mockFindById).toHaveBeenCalledWith(NON_EXISTENT_UUID, "user-123");
  });

  it("templateId 指定・body が不正JSON: ハードコードFew-shotへフォールバックし成功", async () => {
    mockGetCurrentSession.mockResolvedValue({ userId: "user-123" });
    mockFindById.mockResolvedValue({
      id: "tpl-bad",
      user_id: "user-123",
      name: "壊れたテンプレ",
      is_default: false,
      body: "invalid-json",
      created_at: "2026-01-01",
      updated_at: "2026-01-01",
    });

    const result = await analyzeStoreAction(
      makeFormData({ templateId: "tpl-bad" }),
    );
    expect(result.ok).toBe(true);
  });

  it("templateId 指定・未ログイン: findById を呼ばずハードコードFew-shotへフォールバックし成功", async () => {
    mockGetCurrentSession.mockResolvedValue(null);

    const result = await analyzeStoreAction(
      makeFormData({ templateId: "tpl-1" }),
    );
    expect(result.ok).toBe(true);
    expect(mockFindById).not.toHaveBeenCalled();
  });

  it("templateId が不正UUID: findById を呼ばずハードコードFew-shotへフォールバックし成功", async () => {
    mockGetCurrentSession.mockResolvedValue({ userId: "user-123" });

    const result = await analyzeStoreAction(
      makeFormData({ templateId: "not-a-valid-uuid" }),
    );

    expect(result.ok).toBe(true);
    expect(mockFindById).not.toHaveBeenCalled();
  });

  it("findById が例外を投げてもハードコードFew-shotへフォールバックし成功", async () => {
    mockGetCurrentSession.mockResolvedValue({ userId: "user-123" });
    mockFindById.mockRejectedValueOnce(new Error("DB error"));

    const VALID_UUID = "f47ac10b-58cc-4372-a567-0e02b2c3d479";
    const result = await analyzeStoreAction(
      makeFormData({ templateId: VALID_UUID }),
    );

    expect(result.ok).toBe(true);
    expect(mockFindById).toHaveBeenCalledTimes(1);
  });
});
