/**
 * `workflows/store-research.ts` の純関数(retry分類・error_kind導出)の単体検証。
 * AI 店舗調査再設計 Plan v3.2 §17, PR3。
 *
 * 注意: "use workflow" / "use step" ディレクティブが実際に Vercel Workflow の
 * step/workflowとして正しくコンパイル・実行されるかは、本テストでは検証できない
 * (Next.jsのコンパイラプラグインとVercelのランタイムに依存するため、実デプロイでの
 * 手動確認が別途必要)。ここでは純粋なロジック(`classifyForWorkflowRetry` /
 * `deriveErrorKind`)のみを検証する。
 */

import { describe, it, expect, vi } from "vitest";
import { FatalError, RetryableError } from "workflow";
import type { AiClientError } from "@/lib/ai/client";

// store-research.ts は "use step" 関数内で repos / pipeline / resolver / places-verified を
// 参照するため、モジュールの静的 import が DB 接続 (`@/lib/repositories`) を要求する。
// 本テストは純関数(`classifyForWorkflowRetry` / `deriveErrorKind`)のみを検証するため、
// これらを軽量モックに差し替えて DB 接続を避ける。
vi.mock("server-only", () => ({}));
vi.mock("@/lib/repositories", () => ({ repos: {} }));
vi.mock("@/lib/ai/research/pipeline", () => ({
  runStage1: vi.fn(),
  runStage2: vi.fn(),
  buildNonAiItems: vi.fn(),
  applyUrlContextStatus: vi.fn(),
  finalizeResearchItems: vi.fn(),
}));
vi.mock("@/lib/ai/research/source-url-resolver", () => ({
  resolveGroundingRedirectUrl: vi.fn(),
}));
vi.mock("@/lib/ai/research/places-verified", () => ({
  derivePlacesVerifiedKeys: vi.fn(),
}));

const { classifyForWorkflowRetry, deriveErrorKind } = await import("../store-research");

describe("classifyForWorkflowRetry (retry方針の分類、Plan v3.2 §17)", () => {
  it.each<AiClientError["kind"]>(["rate_limit", "timeout", "network_error"])(
    "%s は RetryableError (最大1 retry) になる",
    (kind) => {
      const err: AiClientError = { kind } as AiClientError;
      const result = classifyForWorkflowRetry(err);
      expect(result).toBeInstanceOf(RetryableError);
    },
  );

  it.each<AiClientError["kind"]>(["missing_api_key", "auth_error"])(
    "%s は FatalError (retry 0) になる",
    (kind) => {
      const err: AiClientError = { kind } as AiClientError;
      const result = classifyForWorkflowRetry(err);
      expect(result).toBeInstanceOf(FatalError);
    },
  );

  it.each<AiClientError>([
    { kind: "max_tokens" },
    { kind: "api_error", status: 500 },
    { kind: "unknown", message: "x" },
  ])("その他のkind($kind)はFatalError(安全側)になる", (err) => {
    const result = classifyForWorkflowRetry(err);
    expect(result).toBeInstanceOf(FatalError);
  });

  it("AiClientError以外の通常エラーもFatalErrorになる", () => {
    const result = classifyForWorkflowRetry(new Error("何か普通のエラー"));
    expect(result).toBeInstanceOf(FatalError);
  });

  it("非Errorのthrow値もFatalErrorへ変換される", () => {
    const result = classifyForWorkflowRetry("文字列でthrow");
    expect(result).toBeInstanceOf(FatalError);
  });
});

describe("deriveErrorKind (error_kind導出)", () => {
  it("FatalErrorは'fatal'になる", () => {
    expect(deriveErrorKind(new FatalError("x"))).toBe("fatal");
  });

  it("RetryableErrorは'retryable_exhausted'になる", () => {
    expect(deriveErrorKind(new RetryableError("x"))).toBe("retryable_exhausted");
  });

  it("AiClientErrorはそのkindになる", () => {
    const err: AiClientError = { kind: "rate_limit" };
    expect(deriveErrorKind(err)).toBe("rate_limit");
  });

  it("それ以外はunknownになる", () => {
    expect(deriveErrorKind(new Error("x"))).toBe("unknown");
    expect(deriveErrorKind("plain string")).toBe("unknown");
  });
});
