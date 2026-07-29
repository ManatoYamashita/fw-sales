/**
 * `generateSalesAssetsAction` の回帰テスト (Gemini 3.6 Flash 移行)。
 *
 * 本 PR はモデルと sampling parameter だけを変えるため、**手動貼付フローの振る舞いが
 * 一切変わっていないこと**を固定するのが目的。あわせて新設のエラー分類
 * (`model_not_found` / `max_tokens`) が UI 文言まで届くことを確認する。
 *
 * テスト方針:
 * - `@/lib/ai/client` / `@/lib/repositories` / `next/cache` / `@/lib/supabase/server` を mock し、
 *   実 API・DB・Next cache を叩かない
 * - `buildSalesAssetsPrompt` / `validateAiAnalysis` / `getAiAnalysisJsonSchema` は純粋な
 *   実装をそのまま使う (プロンプト構築の回帰もここで拾えるようにする)
 * - `isAiClientError` も実装をそのまま使う (client 側 union との整合を検証したいため)
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AiAnalysisResult } from "@/lib/ai/schema";
import type { Store } from "@/types/store";

vi.mock("server-only", () => ({}));

const {
  mockGenerateAnalysis,
  mockStoreGet,
  mockStoreUpdate,
  mockProfileFindById,
  mockRevalidateTag,
  mockGetCurrentSession,
} = vi.hoisted(() => ({
  mockGenerateAnalysis: vi.fn(),
  mockStoreGet: vi.fn(),
  mockStoreUpdate: vi.fn(),
  mockProfileFindById: vi.fn(),
  mockRevalidateTag: vi.fn(),
  mockGetCurrentSession: vi.fn(),
}));

// createGeminiClient のみ差し替え、isAiClientError は実装を使う
// (union に kind を足したとき action 側が追随できているかを検証したいため)。
vi.mock("@/lib/ai/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai/client")>();
  return {
    ...actual,
    createGeminiClient: () => ({ generateAnalysis: mockGenerateAnalysis }),
  };
});

vi.mock("@/lib/repositories", () => ({
  repos: {
    store: { get: mockStoreGet, update: mockStoreUpdate },
    profile: { findById: mockProfileFindById },
  },
}));

vi.mock("next/cache", () => ({ revalidateTag: mockRevalidateTag }));
vi.mock("@/lib/supabase/server", () => ({
  getCurrentSession: mockGetCurrentSession,
}));

const { generateSalesAssetsAction } = await import("../sales-assets-actions");
const { _resetRateLimitForTest } = await import("@/lib/ai/rate-limiter");

const VALID_RESULT: AiAnalysisResult = {
  strengths_markdown: "## 強み\n- 駅近",
  weaknesses_markdown: "## 弱み\n- 露出不足",
  gourmet_paid_status: "食べログ 050 番号あり",
  gbp_completeness: "- 説明欄: あり",
  call_script: "私ファーストWEBの山田と申しまして",
  confidence: {
    strengths: 80,
    weaknesses: 70,
    gourmet_paid_status: 60,
    gbp_completeness: 75,
    call_script: 65,
  },
};

function makeStore(overrides: Partial<Store> = {}): Store {
  return {
    id: "store-1",
    name: "導楽",
    basic_info: {},
    assigned_sales_user_id: null,
    ...overrides,
  } as Store;
}

/** storeId ごとの rate limit を跨がないよう、テストごとに一意な id を使う。 */
let seq = 0;
const nextStoreId = () => `store-${++seq}`;

/** 直近の `generateAnalysis` 呼出引数。未呼出なら明示的に失敗させる。 */
function lastAnalysisCall(): {
  input: {
    systemPrompt: string;
    userParts: Array<{ text?: string }>;
    jsonSchema: unknown;
  };
  signal: unknown;
} {
  const call = mockGenerateAnalysis.mock.calls.at(-1);
  if (!call) throw new Error("generateAnalysis が呼ばれていない");
  return { input: call[0], signal: call[1] };
}

/** user Parts のテキストを連結する (プロンプトに何が載ったかの検証用)。 */
function joinedUserParts(): string {
  return lastAnalysisCall()
    .input.userParts.map((p) => p.text ?? "")
    .join("\n");
}

beforeEach(() => {
  vi.clearAllMocks();
  _resetRateLimitForTest();
  mockGetCurrentSession.mockResolvedValue({ user: { id: "u1" } });
  mockStoreUpdate.mockResolvedValue(undefined);
  mockProfileFindById.mockResolvedValue({ display_name: "山田" });
});

describe("generateSalesAssetsAction — ガード", () => {
  it("未認証は failure で、AI も DB も呼ばない", async () => {
    mockGetCurrentSession.mockResolvedValue(null);
    const res = await generateSalesAssetsAction(nextStoreId(), "");

    expect(res).toMatchObject({ ok: false, error: "ログインが必要です" });
    expect(mockGenerateAnalysis).not.toHaveBeenCalled();
    expect(mockStoreGet).not.toHaveBeenCalled();
  });

  it("storeId 空文字は failure", async () => {
    const res = await generateSalesAssetsAction("   ", "");
    expect(res).toMatchObject({ ok: false });
    expect(mockGenerateAnalysis).not.toHaveBeenCalled();
  });

  it("rate limit 超過は failure で AI を呼ばない (API コスト発生前の防御)", async () => {
    const id = nextStoreId();
    mockStoreGet.mockResolvedValue(makeStore({ id }));
    mockGenerateAnalysis.mockResolvedValue(VALID_RESULT);

    // per-store は 10 分 5 回まで
    for (let i = 0; i < 5; i++) {
      await generateSalesAssetsAction(id, "");
    }
    const callsBefore = mockGenerateAnalysis.mock.calls.length;
    const res = await generateSalesAssetsAction(id, "");

    expect(res.ok).toBe(false);
    expect(mockGenerateAnalysis.mock.calls.length).toBe(callsBefore);
  });

  it("店舗が存在しないと failure", async () => {
    mockStoreGet.mockResolvedValue(null);
    const res = await generateSalesAssetsAction(nextStoreId(), "");

    expect(res).toMatchObject({ ok: false, error: "店舗が見つかりません" });
    expect(mockGenerateAnalysis).not.toHaveBeenCalled();
  });

  it("店舗名が空だと failure", async () => {
    mockStoreGet.mockResolvedValue(makeStore({ name: "  " }));
    const res = await generateSalesAssetsAction(nextStoreId(), "");

    expect(res).toMatchObject({ ok: false, error: "店舗名が設定されていません" });
    expect(mockGenerateAnalysis).not.toHaveBeenCalled();
  });
});

describe("generateSalesAssetsAction — 正常系 (手動貼付フローの回帰)", () => {
  it("生成結果を ai_analysis_result へ直接保存し、キャッシュを無効化する", async () => {
    const id = nextStoreId();
    mockStoreGet.mockResolvedValue(makeStore({ id }));
    mockGenerateAnalysis.mockResolvedValue(VALID_RESULT);

    const res = await generateSalesAssetsAction(id, "調査結果テキスト");

    expect(res).toMatchObject({ ok: true, data: VALID_RESULT });
    expect(mockStoreUpdate).toHaveBeenCalledWith(id, {
      ai_analysis_result: VALID_RESULT,
    });
    expect(mockRevalidateTag).toHaveBeenCalled();
  });

  it("貼付テキストありは調査結果 Part がプロンプトに載る", async () => {
    mockStoreGet.mockResolvedValue(makeStore());
    mockGenerateAnalysis.mockResolvedValue(VALID_RESULT);

    await generateSalesAssetsAction(nextStoreId(), "口コミ評価は 3.5 です");

    const texts = joinedUserParts();
    expect(texts).toContain("口コミ評価は 3.5 です");
    expect(texts).toContain("調査結果テキスト");
  });

  it("貼付テキストなしでも基本情報のみで生成できる", async () => {
    mockStoreGet.mockResolvedValue(makeStore());
    mockGenerateAnalysis.mockResolvedValue(VALID_RESULT);

    const res = await generateSalesAssetsAction(nextStoreId(), "");

    expect(res.ok).toBe(true);
    expect(joinedUserParts()).not.toContain("調査結果テキスト");
  });

  it("追加指示ありは追加指示 Part が載り、JSON Schema は据置", async () => {
    mockStoreGet.mockResolvedValue(makeStore());
    mockGenerateAnalysis.mockResolvedValue(VALID_RESULT);

    await generateSalesAssetsAction(nextStoreId(), "", "ランチ需要を強調して");

    const { input } = lastAnalysisCall();
    expect(joinedUserParts()).toContain("ランチ需要を強調して");
    expect(input.jsonSchema).toBeTypeOf("object");
  });

  it("営業担当が割当済みなら発信者名に display_name を差し込む", async () => {
    mockStoreGet.mockResolvedValue(
      makeStore({ assigned_sales_user_id: "user-1" }),
    );
    mockGenerateAnalysis.mockResolvedValue(VALID_RESULT);

    await generateSalesAssetsAction(nextStoreId(), "");

    expect(mockProfileFindById).toHaveBeenCalledWith("user-1");
    expect(lastAnalysisCall().input.systemPrompt).toContain(
      "私ファーストWEBの山田と申しまして",
    );
  });

  it("AbortSignal を渡す (timeout 制御が失われていない)", async () => {
    mockStoreGet.mockResolvedValue(makeStore());
    mockGenerateAnalysis.mockResolvedValue(VALID_RESULT);

    await generateSalesAssetsAction(nextStoreId(), "");

    expect(lastAnalysisCall().signal).toBeInstanceOf(AbortSignal);
  });
});

describe("generateSalesAssetsAction — 異常系", () => {
  it("Zod 検証に落ちたら store を更新しない", async () => {
    mockStoreGet.mockResolvedValue(makeStore());
    mockGenerateAnalysis.mockResolvedValue({ strengths_markdown: "強みだけ" });

    const res = await generateSalesAssetsAction(nextStoreId(), "");

    expect(res.ok).toBe(false);
    expect(mockStoreUpdate).not.toHaveBeenCalled();
    expect(mockRevalidateTag).not.toHaveBeenCalled();
  });

  it.each([
    ["missing_api_key", "GEMINI_API_KEY"],
    ["auth_error", "GEMINI_API_KEY"],
    ["rate_limit", "レートリミット"],
    ["network_error", "ネットワークエラー"],
    // 本 PR で追加した分類。汎用文言に落ちず、原因が読み取れることを固定する。
    ["max_tokens", "長さ上限"],
  ])("AiClientError %s は専用の UI 文言になる", async (kind, expected) => {
    mockStoreGet.mockResolvedValue(makeStore());
    mockGenerateAnalysis.mockRejectedValue({ kind });

    const res = await generateSalesAssetsAction(nextStoreId(), "");

    expect(res.ok).toBe(false);
    expect(res.ok === false && res.error).toContain(expected);
    expect(mockStoreUpdate).not.toHaveBeenCalled();
  });

  it("timeout の文言は TIMEOUT_MS と一致する (定数と文言の乖離防止)", async () => {
    mockStoreGet.mockResolvedValue(makeStore());
    mockGenerateAnalysis.mockRejectedValue({ kind: "timeout" });

    const res = await generateSalesAssetsAction(nextStoreId(), "");

    expect(res.ok === false && res.error).toContain("60 秒");
  });

  it.each([503, 404])(
    "api_error は status %s を文言に含める (404 の切り分けも可能にする)",
    async (status) => {
      mockStoreGet.mockResolvedValue(makeStore());
      mockGenerateAnalysis.mockRejectedValue({ kind: "api_error", status });

      const res = await generateSalesAssetsAction(nextStoreId(), "");

      expect(res.ok === false && res.error).toContain(String(status));
    },
  );

  it("AiClientError でない例外は汎用文言にフォールバックする", async () => {
    mockStoreGet.mockResolvedValue(makeStore());
    mockGenerateAnalysis.mockRejectedValue(new Error("想定外"));

    const res = await generateSalesAssetsAction(nextStoreId(), "");

    expect(res).toMatchObject({
      ok: false,
      error: "AI 生成でエラーが発生しました。再度お試しください。",
    });
  });

  it("担当者解決に失敗しても生成は継続する", async () => {
    mockStoreGet.mockResolvedValue(
      makeStore({ assigned_sales_user_id: "user-x" }),
    );
    mockProfileFindById.mockRejectedValue(new Error("db down"));
    mockGenerateAnalysis.mockResolvedValue(VALID_RESULT);

    const res = await generateSalesAssetsAction(nextStoreId(), "");

    expect(res.ok).toBe(true);
    // 担当者名が引けない場合は neutral placeholder に差し替わる
    expect(lastAnalysisCall().input.systemPrompt).toContain(
      "私ファーストWEBの担当者と申しまして",
    );
  });
});
