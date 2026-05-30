/**
 * DeepResearchClient の単体テスト (deep-research-pipeline spec #43, Task 2.2)
 *
 * カバレッジ (8 ケース):
 * 1. mapInteractionToState: status=in_progress → state=in_progress
 * 2. mapInteractionToState: status=requires_action → state=in_progress (待機扱い)
 * 3. mapInteractionToState: status=completed + outputs → Markdown と URL 抽出成功
 * 4. mapInteractionToState: status=failed → state=failed + reason
 * 5. mapInteractionToState: status=cancelled / incomplete → state=failed 扱い
 * 6. startTask: API キー未設定 → throw missing_api_key
 * 7. startTask: SDK モック経由で id を返す
 * 8. cancelTask: SDK モック経由で cancelled=true
 *
 * SDK エラーから API キー文字列・request ID が漏出しないことも確認 (R6.6)。
 *
 * 関連: requirements.md §3.1, §3.6, §5.4, §6.6
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Interactions } from "@google/genai";

const { mockCreate, mockGet, mockCancel } = vi.hoisted(() => ({
  mockCreate: vi.fn(),
  mockGet: vi.fn(),
  mockCancel: vi.fn(),
}));

// `GoogleGenAI` を class モック化、`interactions` accessor を露出
vi.mock("@google/genai", async () => {
  return {
    GoogleGenAI: class MockGoogleGenAI {
      interactions = {
        create: mockCreate,
        get: mockGet,
        cancel: mockCancel,
      };
      constructor(_opts: { apiKey: string }) {
        void _opts;
      }
    },
    // namespace Interactions は型のみ。実体は不要なので空オブジェクト
    Interactions: {},
  };
});

import {
  createDeepResearchClient,
  mapInteractionToState,
} from "../client";

type Interaction = Interactions.Interaction;

const SIGNAL = new AbortController().signal;

beforeEach(() => {
  process.env.GEMINI_API_KEY = "test-key-xxx";
  mockCreate.mockReset();
  mockGet.mockReset();
  mockCancel.mockReset();
});

afterEach(() => {
  delete process.env.GEMINI_API_KEY;
});

describe("mapInteractionToState", () => {
  it("status=in_progress → state=in_progress", () => {
    const result = mapInteractionToState({
      id: "i_1",
      created: "2026-05-17T00:00:00Z",
      updated: "2026-05-17T00:00:00Z",
      status: "in_progress",
    } as Interaction);
    expect(result.state).toBe("in_progress");
  });

  it("status=requires_action → state=in_progress (待機扱い)", () => {
    const result = mapInteractionToState({
      id: "i_2",
      created: "2026-05-17T00:00:00Z",
      updated: "2026-05-17T00:00:00Z",
      status: "requires_action",
    } as Interaction);
    expect(result.state).toBe("in_progress");
  });

  it("status=completed: outputs から Markdown と URL を抽出", () => {
    const interaction: Interaction = {
      id: "i_3",
      created: "2026-05-17T00:00:00Z",
      updated: "2026-05-17T00:00:00Z",
      status: "completed",
      outputs: [
        {
          type: "text",
          text: "## レポート\nサンプル店舗の概要。",
          annotations: [
            {
              type: "url_citation",
              url: "https://example.com/a",
              title: "A",
            },
            {
              type: "url_citation",
              url: "https://example.com/b",
              title: "B",
            },
          ],
        } as never,
      ],
      usage: {
        total_input_tokens: 500,
        total_output_tokens: 1200,
      } as never,
    } as Interaction;
    const result = mapInteractionToState(interaction);
    expect(result.state).toBe("completed");
    if (result.state === "completed") {
      expect(result.reportMarkdown).toContain("サンプル店舗");
      expect(result.sourceUrls.sort()).toEqual([
        "https://example.com/a",
        "https://example.com/b",
      ]);
      expect(result.tokenUsage?.promptTokens).toBe(500);
      expect(result.tokenUsage?.outputTokens).toBe(1200);
    }
  });

  it("status=failed → state=failed + reason", () => {
    const result = mapInteractionToState({
      id: "i_4",
      created: "2026-05-17T00:00:00Z",
      updated: "2026-05-17T00:00:00Z",
      status: "failed",
    } as Interaction);
    expect(result.state).toBe("failed");
    if (result.state === "failed") {
      expect(result.reason).toContain("failed");
    }
  });

  it.each([["cancelled"], ["incomplete"]])(
    "status=%s → state=failed として正規化",
    (status) => {
      const result = mapInteractionToState({
        id: "i_5",
        created: "2026-05-17T00:00:00Z",
        updated: "2026-05-17T00:00:00Z",
        status,
      } as Interaction);
      expect(result.state).toBe("failed");
    },
  );
});

describe("DeepResearchClient", () => {
  it("startTask: API キー未設定 → throw missing_api_key", async () => {
    delete process.env.GEMINI_API_KEY;
    const client = createDeepResearchClient();
    await expect(
      client.startTask(
        { systemPrompt: "sys", userPrompt: "user" },
        SIGNAL,
      ),
    ).rejects.toMatchObject({ kind: "missing_api_key" });
  });

  it("startTask: SDK モック経由で id を返す & systemPrompt + userPrompt が input に結合される", async () => {
    mockCreate.mockResolvedValueOnce({ id: "interactions/abc123" });
    const client = createDeepResearchClient();
    const result = await client.startTask(
      { systemPrompt: "sys", userPrompt: "user" },
      SIGNAL,
    );
    expect(result.taskId).toBe("interactions/abc123");
    expect(mockCreate).toHaveBeenCalledTimes(1);
    const args = mockCreate.mock.calls[0]?.[0] as Record<string, unknown>;
    // deep-research-preview-04-2026 は system_instruction 非対応のため、
    // systemPrompt + \n\n + userPrompt を input に集約して渡す。
    expect(args).toMatchObject({
      input: "sys\n\nuser",
      background: true,
    });
    expect(args).not.toHaveProperty("system_instruction");
    expect(typeof args.agent).toBe("string");
  });

  it("startTask: systemPrompt が空でも userPrompt のみで送られる", async () => {
    mockCreate.mockResolvedValueOnce({ id: "interactions/def456" });
    const client = createDeepResearchClient();
    await client.startTask(
      { systemPrompt: "", userPrompt: "user only" },
      SIGNAL,
    );
    const args = mockCreate.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(args.input).toBe("user only");
    expect(args).not.toHaveProperty("system_instruction");
  });

  it("cancelTask: SDK モック経由で cancelled=true", async () => {
    mockCancel.mockResolvedValueOnce({ id: "i_x", status: "cancelled" });
    const client = createDeepResearchClient();
    const result = await client.cancelTask(
      { taskId: "interactions/xyz" },
      SIGNAL,
    );
    expect(result.cancelled).toBe(true);
  });

  it("cancelTask: SDK が 404 を返すと already_terminal", async () => {
    mockCancel.mockRejectedValueOnce(new Error("404 not found"));
    const client = createDeepResearchClient();
    const result = await client.cancelTask(
      { taskId: "interactions/xyz" },
      SIGNAL,
    );
    expect(result.cancelled).toBe(false);
    if (!result.cancelled) {
      expect(result.reason).toBe("already_terminal");
    }
  });

  it("startTask: SDK エラーに API キー値が含まれない (R6.6)", async () => {
    mockCreate.mockRejectedValueOnce(
      new Error("API key 'test-key-xxx' is invalid"),
    );
    const client = createDeepResearchClient();
    try {
      await client.startTask(
        { systemPrompt: "sys", userPrompt: "user" },
        SIGNAL,
      );
      throw new Error("should have thrown");
    } catch (err) {
      const e = err as { kind: string; message?: string };
      expect(e.kind).toBe("auth_error");
      // 正規化メッセージに生 API キーが入らないこと
      expect(JSON.stringify(e)).not.toContain("test-key-xxx");
    }
  });

  it("startTask: ApiError(status=400) → kind=api_error + message に HTTP body を保持", async () => {
    // @google/genai の ApiError 形 (status を直接持つ)
    class FakeApiError extends Error {
      status: number;
      constructor(message: string, status: number) {
        super(message);
        this.name = "ApiError";
        this.status = status;
      }
    }
    const body =
      '{"error":{"code":400,"message":"Model deep-research-preview-04-2026 not found","status":"NOT_FOUND"}}';
    mockCreate.mockRejectedValueOnce(new FakeApiError(body, 400));
    const client = createDeepResearchClient();
    try {
      await client.startTask(
        { systemPrompt: "sys", userPrompt: "user" },
        SIGNAL,
      );
      throw new Error("should have thrown");
    } catch (err) {
      const e = err as { kind: string; status?: number; message?: string };
      expect(e.kind).toBe("api_error");
      expect(e.status).toBe(400);
      expect(e.message).toContain("Model deep-research-preview-04-2026 not found");
    }
  });

  it("startTask: ApiError(status=404) → kind=not_found", async () => {
    class FakeApiError extends Error {
      status: number;
      constructor(message: string, status: number) {
        super(message);
        this.name = "ApiError";
        this.status = status;
      }
    }
    mockCreate.mockRejectedValueOnce(new FakeApiError("interaction not found", 404));
    const client = createDeepResearchClient();
    await expect(
      client.startTask({ systemPrompt: "sys", userPrompt: "user" }, SIGNAL),
    ).rejects.toMatchObject({ kind: "not_found" });
  });

  it("startTask: 一般的なシークレット文字列が message から redact される", async () => {
    // AIza... / Bearer ... / sk-... の 3 パターン
    const dirty =
      "Auth failed with key AIzaSyABCDEFGHIJKLMNOPQRSTUVWXYZ012345, sent header 'Bearer abc.def.ghi-jkl_mno=' and OpenAI sk-proj-AAAAAAAAAAAAAAAAAAAAAAAA";
    mockCreate.mockRejectedValueOnce(new Error(dirty));
    const client = createDeepResearchClient();
    try {
      await client.startTask(
        { systemPrompt: "sys", userPrompt: "user" },
        SIGNAL,
      );
      throw new Error("should have thrown");
    } catch (err) {
      const serialized = JSON.stringify(err);
      // 各パターンの実値が漏れていないこと
      expect(serialized).not.toContain("AIzaSyABCDEFGHIJKLMNOPQRSTUVWXYZ012345");
      expect(serialized).not.toContain("abc.def.ghi-jkl_mno=");
      expect(serialized).not.toContain("sk-proj-AAAAAAAAAAAAAAAAAAAAAAAA");
      // redacted トークンが含まれること
      expect(serialized).toContain("AIza***");
      expect(serialized).toContain("Bearer ***");
      expect(serialized).toContain("sk-***");
    }
  });
});
