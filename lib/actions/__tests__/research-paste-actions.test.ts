/**
 * research-paste-actions の単体テスト (Issue #102 手動貼付フロー)。
 *
 * deep-research-actions.test.ts / ai-analysis-actions.test.ts と同型の
 * vi.hoisted + vi.mock パターンで repos / session / structurer / gemini client /
 * next/cache をモックし、副作用を排除して以下を検証する:
 * - structureFromPastedMarkdownAction: 成功時の full_markdown 注入・done 化・stage 更新、
 *   構造化失敗時のフォールバック(空カテゴリ + 原文保存)、架電済みの非降格
 * - generateCallScriptFromMarkdownAction: 生成のみ(非永続化)、貼付 Markdown を htmlContent に流す
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockStoreRepo,
  mockDeepResearchRepo,
  mockProfileRepo,
  mockTransaction,
  mockGetCurrentSession,
  mockRevalidateTag,
  mockCreateStructurer,
  mockStructure,
  mockCreateGeminiClient,
  mockGenerateAnalysis,
} = vi.hoisted(() => ({
  mockStoreRepo: { get: vi.fn(), update: vi.fn() },
  mockDeepResearchRepo: {
    insertJob: vi.fn(),
    insertReport: vi.fn(),
    updateJobStatus: vi.fn(),
    appendJobError: vi.fn(),
  },
  mockProfileRepo: { findById: vi.fn() },
  mockTransaction: vi.fn(),
  mockGetCurrentSession: vi.fn(),
  mockRevalidateTag: vi.fn(),
  mockCreateStructurer: vi.fn(),
  mockStructure: vi.fn(),
  mockCreateGeminiClient: vi.fn(),
  mockGenerateAnalysis: vi.fn(),
}));

vi.mock("@/lib/repositories", () => ({
  repos: {
    store: mockStoreRepo,
    deepResearch: mockDeepResearchRepo,
    profile: mockProfileRepo,
    transaction: mockTransaction,
  },
}));

vi.mock("@/lib/supabase/server", () => ({
  getCurrentSession: mockGetCurrentSession,
}));

vi.mock("next/cache", () => ({
  revalidateTag: mockRevalidateTag,
}));

vi.mock("@/lib/ai/deep-research/structurer", () => ({
  createStructurer: mockCreateStructurer,
}));

vi.mock("@/lib/ai/client", () => ({
  createGeminiClient: mockCreateGeminiClient,
}));

import {
  structureFromPastedMarkdownAction,
  generateCallScriptFromMarkdownAction,
} from "../research-paste-actions";
import { _resetRateLimitForTest } from "@/lib/ai/rate-limiter";
import type { Store } from "@/types/store";

const SESSION = { userId: "user-1", email: "u@test.com" };
const STORE_ID = "store_abc";
const MARKDOWN = "## 基本情報\n### 店名\n導楽は良い店です。";

function makeStore(overrides: Partial<Store> = {}): Store {
  return {
    id: STORE_ID,
    name: "導楽",
    prefecture: "神奈川県",
    city: "川崎市中原区",
    address: "新丸子駅周辺",
    genre: "居酒屋",
    priority: "中",
    stage: "未調査",
    has_contact_form: "未確認",
    channel: "未判定",
    map_url: "",
    site_url: "",
    instagram_url: "",
    phone: "",
    target_service: "",
    review_count: 12,
    review_avg: 3.4,
    memo: "",
    assigned_planner_user_id: null,
    assigned_sales_user_id: null,
    operator_type: "未設定",
    operator_name: "",
    ai_analysis_result: null,
    lat: null,
    lng: null,
    business_hours: "",
    google_place_id: null,
    created_at: "2026-06-01",
    updated_at: "2026-06-01",
    ...overrides,
  } as Store;
}

const STRUCTURED_DATA = {
  category_1_basic: [{ key: "k", label: "L", value: "v", tier: "A" }],
  category_2_owner: [],
  category_3_menu: [],
  category_4_customer: [],
  category_5_marketing: [],
  category_6_competitor: [],
  category_7_owned_media: [],
  category_8_other: [],
  hearing_questions: [],
  all_source_urls: ["https://example.com"],
};

const VALID_ANALYSIS = {
  strengths_markdown: "## 強み\n- 立地が良い",
  weaknesses_markdown: "## 弱み\n- 客単価が低い",
  gourmet_paid_status: "食べログ無料プラン",
  gbp_completeness: "説明欄あり",
  call_script: "私ファーストWEBの担当者と申しまして",
  confidence: {
    strengths: 80,
    weaknesses: 70,
    gourmet_paid_status: 60,
    gbp_completeness: 75,
    call_script: 85,
  },
};

beforeEach(() => {
  vi.resetAllMocks();
  _resetRateLimitForTest();
  mockGetCurrentSession.mockResolvedValue(SESSION);
  mockStoreRepo.get.mockResolvedValue(makeStore());
  mockStoreRepo.update.mockResolvedValue(makeStore());
  mockDeepResearchRepo.insertJob.mockResolvedValue({
    id: "job_1",
    store_id: STORE_ID,
    status: "queued",
  });
  mockDeepResearchRepo.insertReport.mockResolvedValue({ id: "report_1" });
  mockDeepResearchRepo.updateJobStatus.mockResolvedValue({ id: "job_1" });
  mockDeepResearchRepo.appendJobError.mockResolvedValue({ id: "job_1" });
  // transaction はコールバックに { deepResearch } を渡して結果を返す。
  mockTransaction.mockImplementation(
    async (fn: (tx: { deepResearch: typeof mockDeepResearchRepo }) => unknown) =>
      fn({ deepResearch: mockDeepResearchRepo }),
  );
  mockCreateStructurer.mockReturnValue({ structure: mockStructure });
  mockCreateGeminiClient.mockReturnValue({
    generateAnalysis: mockGenerateAnalysis,
  });
});

describe("structureFromPastedMarkdownAction", () => {
  it("Markdown が空なら失敗を返す", async () => {
    const res = await structureFromPastedMarkdownAction(STORE_ID, "   ");
    expect(res.ok).toBe(false);
    expect(mockDeepResearchRepo.insertJob).not.toHaveBeenCalled();
  });

  it("未認証なら失敗を返す", async () => {
    mockGetCurrentSession.mockResolvedValue(null);
    const res = await structureFromPastedMarkdownAction(STORE_ID, MARKDOWN);
    expect(res.ok).toBe(false);
  });

  it("構造化成功時: full_markdown に貼付原文を注入し job を done 化、stage を DeepResearch済みへ", async () => {
    mockStructure.mockResolvedValue({ ok: true, data: STRUCTURED_DATA });

    const res = await structureFromPastedMarkdownAction(STORE_ID, MARKDOWN);

    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.structured).toBe(true);
    // 1 回目で成功するため再試行しない。
    expect(mockStructure).toHaveBeenCalledTimes(1);
    expect(mockDeepResearchRepo.insertReport).toHaveBeenCalledWith(
      expect.objectContaining({
        job_id: "job_1",
        store_id: STORE_ID,
        full_markdown: MARKDOWN,
        category_1_basic: STRUCTURED_DATA.category_1_basic,
        all_source_urls: STRUCTURED_DATA.all_source_urls,
        total_cost_yen: null,
      }),
    );
    expect(mockDeepResearchRepo.updateJobStatus).toHaveBeenCalledWith(
      "job_1",
      expect.objectContaining({ status: "done", stage1_markdown: MARKDOWN }),
    );
    expect(mockStoreRepo.update).toHaveBeenCalledWith(STORE_ID, {
      stage: "DeepResearch済み",
    });
  });

  it("構造化が 2 回とも失敗: 8 カテゴリ空配列 + 原文のみ保存 (structured=false)", async () => {
    mockStructure.mockResolvedValue({
      ok: false,
      error: { kind: "invalid_json", message: "broken" },
    });

    const res = await structureFromPastedMarkdownAction(STORE_ID, MARKDOWN);

    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.structured).toBe(false);
    // concise 再試行で 2 回呼ばれる。
    expect(mockStructure).toHaveBeenCalledTimes(2);
    expect(mockDeepResearchRepo.insertReport).toHaveBeenCalledWith(
      expect.objectContaining({
        full_markdown: MARKDOWN,
        category_1_basic: [],
        category_8_other: [],
        hearing_questions: [],
        all_source_urls: [],
      }),
    );
    // フォールバックでも job は done 化する。
    expect(mockDeepResearchRepo.updateJobStatus).toHaveBeenCalledWith(
      "job_1",
      expect.objectContaining({ status: "done" }),
    );
  });

  it("既に架電済みの店舗は stage を降格させない", async () => {
    mockStoreRepo.get.mockResolvedValue(makeStore({ stage: "架電済み" }));
    mockStructure.mockResolvedValue({ ok: true, data: STRUCTURED_DATA });

    const res = await structureFromPastedMarkdownAction(STORE_ID, MARKDOWN);

    expect(res.ok).toBe(true);
    expect(mockStoreRepo.update).not.toHaveBeenCalled();
  });

  it("insertJob 後に例外: 作成済み job を failed 化し error_log を残す (queued リーク防止)", async () => {
    mockStructure.mockResolvedValue({ ok: true, data: STRUCTURED_DATA });
    // transaction (insertReport + done 化) を失敗させ、catch 経路へ落とす。
    mockTransaction.mockRejectedValue(new Error("db down"));

    const res = await structureFromPastedMarkdownAction(STORE_ID, MARKDOWN);

    expect(res.ok).toBe(false);
    // 作成済み job (job_1) は failed + completed_at へ遷移させる。
    expect(mockDeepResearchRepo.updateJobStatus).toHaveBeenCalledWith(
      "job_1",
      expect.objectContaining({
        status: "failed",
        completed_at: expect.any(String),
      }),
    );
    // error_log に失敗エントリを append する。
    expect(mockDeepResearchRepo.appendJobError).toHaveBeenCalledWith(
      "job_1",
      expect.objectContaining({
        stage: "stage2",
        kind: "manual_paste_structure_failed",
      }),
    );
  });

  it("cleanup 自体が失敗しても元エラーの失敗結果を返す (二重例外を握り潰す)", async () => {
    mockStructure.mockResolvedValue({ ok: true, data: STRUCTURED_DATA });
    mockTransaction.mockRejectedValue(new Error("db down"));
    mockDeepResearchRepo.updateJobStatus.mockRejectedValue(
      new Error("cleanup also failed"),
    );

    const res = await structureFromPastedMarkdownAction(STORE_ID, MARKDOWN);

    expect(res.ok).toBe(false);
  });
});

describe("generateCallScriptFromMarkdownAction", () => {
  it("Markdown が空なら失敗を返す", async () => {
    const res = await generateCallScriptFromMarkdownAction(STORE_ID, "");
    expect(res.ok).toBe(false);
    expect(mockGenerateAnalysis).not.toHaveBeenCalled();
  });

  it("成功時: 検証済み結果を返すが永続化はしない (store.update を呼ばない)", async () => {
    mockGenerateAnalysis.mockResolvedValue(VALID_ANALYSIS);

    const res = await generateCallScriptFromMarkdownAction(STORE_ID, MARKDOWN);

    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.call_script).toBe(VALID_ANALYSIS.call_script);
    expect(mockStoreRepo.update).not.toHaveBeenCalled();
  });

  it("貼付 Markdown を htmlContent として分析入力 (userParts) に流す", async () => {
    mockGenerateAnalysis.mockResolvedValue(VALID_ANALYSIS);

    await generateCallScriptFromMarkdownAction(STORE_ID, MARKDOWN);

    expect(mockGenerateAnalysis).toHaveBeenCalledTimes(1);
    const input = mockGenerateAnalysis.mock.calls[0]?.[0] as {
      userParts: Array<{ text?: string }>;
    };
    const joined = input.userParts.map((p) => p.text ?? "").join("\n");
    expect(joined).toContain(MARKDOWN);
  });
});
