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

// store-research.ts は "use step" 関数内で repos / pipeline / source-registry /
// places-stage0 / places-verified / basic-info-merge を参照するため、モジュールの
// 静的 import が DB 接続 (`@/lib/repositories`) を要求する。本テストは純関数
// (`classifyForWorkflowRetry` / `deriveErrorKind`)のみを検証するため、
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
vi.mock("@/lib/ai/research/source-registry", () => ({
  buildKnownStoreDataEntries: vi.fn(),
  buildKnownStoreDataUrls: vi.fn(),
  mergeKnownStoreDataIntoRegistry: vi.fn(),
}));
vi.mock("@/lib/ai/research/places-stage0", () => ({
  runStage0PlacesResync: vi.fn(),
}));
vi.mock("@/lib/ai/research/places-verified", () => ({
  derivePlacesVerifiedKeys: vi.fn(),
}));
vi.mock("@/lib/domain/basic-info-merge", () => ({
  mergeBasicInfo: vi.fn(),
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
    { kind: "api_error", status: 400 },
    { kind: "api_error", status: 404 },
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

  it("api_error(503)はRetryableError(最大1 retry)になる(observability bug修正 smoke testで発見、Plan §17)", () => {
    const err: AiClientError = { kind: "api_error", status: 503 };
    const result = classifyForWorkflowRetry(err);
    expect(result).toBeInstanceOf(RetryableError);
  });

  it.each([400, 404, 500, 502, 504])(
    "api_error(%i)はHTTP statusをmessageに保持したままFatalErrorになる",
    (status) => {
      const err: AiClientError = { kind: "api_error", status };
      const result = classifyForWorkflowRetry(err);
      expect(result).toBeInstanceOf(FatalError);
      expect(result.message).toContain(`api_error:${status}`);
    },
  );

  it("api_error(503)のRetryableErrorメッセージにもHTTP statusが残る", () => {
    const err: AiClientError = { kind: "api_error", status: 503 };
    const result = classifyForWorkflowRetry(err);
    expect(result.message).toContain("api_error:503");
  });

  it("生成したmessageにSDKの生メッセージ・request ID・API keyを含まない(sanitized kind + statusのみ)", () => {
    const err: AiClientError = { kind: "api_error", status: 404 };
    const result = classifyForWorkflowRetry(err);
    // 定型文 + kind + status 以外の外部由来テキストが混入していないことを、
    // 既知の定型文パターンとの完全一致で検証する。
    expect(result.message).toBe("Gemini呼出が失敗しました(api_error:404)");
  });
});

describe("deriveErrorKind (error_kind導出)", () => {
  it("sanitized kindを含まないFatalErrorは'fatal'になる(loadStoreStep等Gemini以外由来)", () => {
    expect(deriveErrorKind(new FatalError("x"))).toBe("fatal");
  });

  it("sanitized kindを含まないRetryableErrorは'retryable_exhausted'になる", () => {
    expect(deriveErrorKind(new RetryableError("x"))).toBe("retryable_exhausted");
  });

  it("AiClientErrorはそのkindになる", () => {
    const err: AiClientError = { kind: "rate_limit" };
    expect(deriveErrorKind(err)).toBe("rate_limit");
  });

  it("AiClientError(api_error)はHTTP statusを含む形になる", () => {
    const err: AiClientError = { kind: "api_error", status: 404 };
    expect(deriveErrorKind(err)).toBe("api_error:404");
  });

  it("それ以外はunknownになる", () => {
    expect(deriveErrorKind(new Error("x"))).toBe("unknown");
    expect(deriveErrorKind("plain string")).toBe("unknown");
  });

  describe("observability bug修正(smoke testで発見): classifyForWorkflowRetryの出力からHTTP statusを復元できる", () => {
    it.each([400, 404, 500])("FatalError化したapi_error(%i)は'fatal:api_error:%i'になる", (status) => {
      const classified = classifyForWorkflowRetry({ kind: "api_error", status } as AiClientError);
      expect(deriveErrorKind(classified)).toBe(`fatal:api_error:${status}`);
    });

    it("RetryableError化して力尽きたapi_error(503)は'retryable_exhausted:api_error:503'になる", () => {
      const classified = classifyForWorkflowRetry({
        kind: "api_error",
        status: 503,
      } as AiClientError);
      expect(deriveErrorKind(classified)).toBe("retryable_exhausted:api_error:503");
    });

    it("RetryableError化して力尽きたrate_limitは'retryable_exhausted:rate_limit'になる", () => {
      const classified = classifyForWorkflowRetry({ kind: "rate_limit" } as AiClientError);
      expect(deriveErrorKind(classified)).toBe("retryable_exhausted:rate_limit");
    });

    it("FatalError化したauth_errorは'fatal:auth_error'になる", () => {
      const classified = classifyForWorkflowRetry({ kind: "auth_error" } as AiClientError);
      expect(deriveErrorKind(classified)).toBe("fatal:auth_error");
    });
  });
});
