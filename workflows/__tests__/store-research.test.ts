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

import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { FatalError, RetryableError } from "workflow";
import type { AiClientError } from "@/lib/ai/client";
import {
  GEMINI_RETRY_AFTER_MS,
  GEMINI_STAGE_COUNT,
  GEMINI_STAGE_MAX_RETRIES,
  GEMINI_STAGE_TIMEOUT_MS,
  MAX_GEMINI_RETRY_AFTER_MS,
  MIN_SAFE_EXPIRES_MARGIN_MINUTES,
  PLATFORM_STEP_TIMEOUT_MS,
  STAGE0_MAX_RETRIES,
  DB_STEP_COUNT,
  DB_STEP_MAX_RETRIES,
  DB_STEP_BUDGET_MS,
  computeMinimumSafeExpiryMs,
  getSafeExpiryBudgetBreakdownMs,
} from "@/lib/ai/research/run-timing";
import { getResearchRunExpiresMarginMinutes } from "@/lib/env";

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
  buildDeterministicPlacesItems: vi.fn(),
  DETERMINISTIC_PLACES_KEYS: ["review_avg", "review_count"],
  applyUrlContextStatus: vi.fn(),
  upgradeMediaCoverageFromRegistry: vi.fn(),
  appendConfirmedMediaContext: vi.fn(),
  finalizeResearchItems: vi.fn(),
  // feat/ai-research-pre-smoke-hardening (BLOCKER1): classifyForWorkflowRetryが
  // `instanceof Stage2InvalidOutputError`で判定するため、モック側にも実体が必要。
  // runtime hardening (2026-08-07): 実クラスと同じく`kind`を保持する(4分類の
  // sanitized token化をテストするため)。
  Stage2InvalidOutputError: class Stage2InvalidOutputError extends Error {
    kind: string;
    constructor(message: string, kind: string) {
      super(message);
      this.kind = kind;
    }
  },
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

  it("Stage2InvalidOutputErrorはFatalError(retry 0、自動Gemini再callは追加しない)になる(feat/ai-research-pre-smoke-hardening、BLOCKER1)", async () => {
    const { Stage2InvalidOutputError } = await import("@/lib/ai/research/pipeline");
    const err = new Stage2InvalidOutputError("Stage2の応答をJSONとして解釈できませんでした。", "json_parse");
    const result = classifyForWorkflowRetry(err);
    expect(result).toBeInstanceOf(FatalError);
    expect(result.message).toContain("stage2_invalid_output");
    // 生のGemini応答本文をmessageに含めないこと。
    expect(result.message).not.toContain("JSONとして解釈できませんでした");
  });

  describe("Stage2InvalidOutputErrorの4分類がsanitized kindへ反映される(実機Preview検証、2026-08-07: fatal:stage2_invalid_outputのみではDBから原因が判別できなかった事象への対応)", () => {
    it.each<["json_parse" | "schema" | "coverage" | "identity", string]>([
      ["json_parse", "Stage2の応答をJSONとして解釈できませんでした。"],
      ["schema", "Stage2の応答がスキーマに準拠しませんでした。"],
      ["coverage", "Stage2の応答が不完全でした: 重複したkeyが含まれていました"],
      ["identity", "店舗同定に失敗しました(store_identification_mismatch)"],
    ])("kind=%sは stage2_invalid_output:%s へ、生の元messageを含めずに変換される", async (kind, rawMessage) => {
      const { Stage2InvalidOutputError } = await import("@/lib/ai/research/pipeline");
      const err = new Stage2InvalidOutputError(rawMessage, kind);
      const result = classifyForWorkflowRetry(err);
      expect(result).toBeInstanceOf(FatalError);
      // 定型文 + kind 以外の外部由来テキストが混入していないことを完全一致で検証する。
      expect(result.message).toBe(`Stage2の応答検証に失敗しました(stage2_invalid_output:${kind})`);
    });
  });

  describe("retryAfterの種別ごとの差分(実機Preview検証、2026-08-07: 一律5sから調整)", () => {
    function approxSecondsFromNow(date: Date): number {
      return Math.round((date.getTime() - Date.now()) / 1000);
    }

    it("rate_limitはretryAfter 30s", () => {
      const result = classifyForWorkflowRetry({ kind: "rate_limit" } as AiClientError);
      expect(result).toBeInstanceOf(RetryableError);
      expect(approxSecondsFromNow((result as InstanceType<typeof RetryableError>).retryAfter)).toBe(30);
    });

    it("timeoutはretryAfter 10s", () => {
      const result = classifyForWorkflowRetry({ kind: "timeout" } as AiClientError);
      expect(approxSecondsFromNow((result as InstanceType<typeof RetryableError>).retryAfter)).toBe(10);
    });

    it("network_errorはretryAfter 10s", () => {
      const result = classifyForWorkflowRetry({ kind: "network_error" } as AiClientError);
      expect(approxSecondsFromNow((result as InstanceType<typeof RetryableError>).retryAfter)).toBe(10);
    });

    it("api_error(503)はretryAfter 20s", () => {
      const result = classifyForWorkflowRetry({ kind: "api_error", status: 503 } as AiClientError);
      expect(approxSecondsFromNow((result as InstanceType<typeof RetryableError>).retryAfter)).toBe(20);
    });

    // fix: PR #180 review Finding 3。Workflow側でretryAfterを再ハードコードすると
    // expires margin の安全下限計算と drift し、Finding 3 が再発する。
    it("retryAfterはrun-timing.tsのGEMINI_RETRY_AFTER_MSを参照している(drift検知)", () => {
      const cases = [
        [{ kind: "rate_limit" }, GEMINI_RETRY_AFTER_MS.rate_limit],
        [{ kind: "timeout" }, GEMINI_RETRY_AFTER_MS.timeout],
        [{ kind: "network_error" }, GEMINI_RETRY_AFTER_MS.network_error],
        [{ kind: "api_error", status: 503 }, GEMINI_RETRY_AFTER_MS.service_unavailable],
      ] as const;
      for (const [err, expectedMs] of cases) {
        const result = classifyForWorkflowRetry(err as AiClientError);
        expect(approxSecondsFromNow((result as InstanceType<typeof RetryableError>).retryAfter)).toBe(
          expectedMs / 1000,
        );
      }
    });
  });
});

describe("stuck run 判定の安全下限(fix: PR #180 review Finding 3)", () => {
  const KEY = "RESEARCH_RUN_EXPIRES_MARGIN_MINUTES";
  let saved: string | undefined;

  beforeEach(() => {
    saved = process.env[KEY];
    delete process.env[KEY];
  });

  afterEach(() => {
    if (saved === undefined) delete process.env[KEY];
    else process.env[KEY] = saved;
  });

  it("既定のexpires marginは、正常runが要しうる保守的budgetを下回らない", () => {
    expect(getResearchRunExpiresMarginMinutes() * 60_000).toBeGreaterThanOrEqual(
      computeMinimumSafeExpiryMs(),
    );
  });

  it("env で安全下限未満(旧既定の10分)を設定しても実効値は下限へclampされる", () => {
    // 本番に旧値が残っているケース。コード側defaultの変更だけでは不具合が残るため
    // clamp が必要(実効値は max(env override, safe minimum))。
    process.env[KEY] = "10";
    expect(getResearchRunExpiresMarginMinutes()).toBe(MIN_SAFE_EXPIRES_MARGIN_MINUTES);
    expect(getResearchRunExpiresMarginMinutes() * 60_000).toBeGreaterThanOrEqual(
      computeMinimumSafeExpiryMs(),
    );
  });

  it("env で安全下限より長い値を設定した場合はその値を尊重する(延長方向のoverrideは有効)", () => {
    const longer = MIN_SAFE_EXPIRES_MARGIN_MINUTES + 15;
    process.env[KEY] = String(longer);
    expect(getResearchRunExpiresMarginMinutes()).toBe(longer);
  });

  it("Gemini部分のbudgetはStage1/Stage2のtimeout・retry構成と一致する", () => {
    const perStage =
      GEMINI_STAGE_TIMEOUT_MS * (GEMINI_STAGE_MAX_RETRIES + 1) +
      MAX_GEMINI_RETRY_AFTER_MS * GEMINI_STAGE_MAX_RETRIES;
    expect(getSafeExpiryBudgetBreakdownMs().gemini).toBe(perStage * GEMINI_STAGE_COUNT);
  });

  // Workflow側のstep `.maxRetries` は共有定数(STAGE0_MAX_RETRIES / DB_STEP_MAX_RETRIES)を
  // 参照している。step関数自体はexportしていないため呼び出し回数の実行時検証はできないが、
  // budget側がその定数から導出されていることは固定できる。片方だけ値を変えれば
  // これらのテストが落ちる(= budgetとretry構成のdriftを検知できる)。
  it("Stage0部分のbudgetはSTAGE0_MAX_RETRIESと整合する", () => {
    expect(getSafeExpiryBudgetBreakdownMs().stage0).toBe(
      PLATFORM_STEP_TIMEOUT_MS * (STAGE0_MAX_RETRIES + 1),
    );
  });

  it("DB step部分のbudgetはDB_STEP_MAX_RETRIESと整合する", () => {
    expect(getSafeExpiryBudgetBreakdownMs().dbSteps).toBe(
      DB_STEP_COUNT * (DB_STEP_MAX_RETRIES + 1) * DB_STEP_BUDGET_MS,
    );
  });

  it("computeMinimumSafeExpiryMsは内訳の合計と一致する", () => {
    const b = getSafeExpiryBudgetBreakdownMs();
    expect(b.gemini + b.stage0 + b.dbSteps + b.scheduling + b.safetyMargin).toBe(
      computeMinimumSafeExpiryMs(),
    );
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

  it("stage2_invalid_output由来のFatalErrorは'fatal:stage2_invalid_output'になる(BLOCKER1)", () => {
    expect(deriveErrorKind(new FatalError("Stage2の応答検証に失敗しました(stage2_invalid_output)"))).toBe(
      "fatal:stage2_invalid_output",
    );
  });

  it("final_result_invalid由来のFatalErrorは'fatal:final_result_invalid'になる(BLOCKER1)", () => {
    expect(
      deriveErrorKind(new FatalError("最終結果の整合性検証に失敗しました(final_result_invalid)")),
    ).toBe("fatal:final_result_invalid");
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

  describe("Stage2InvalidOutputErrorの4分類がderiveErrorKindでも往復する", () => {
    it.each<"json_parse" | "schema" | "coverage" | "identity">([
      "json_parse",
      "schema",
      "coverage",
      "identity",
    ])("kind=%sは classifyForWorkflowRetry → deriveErrorKind で 'fatal:stage2_invalid_output:%s' になる", async (kind) => {
      const { Stage2InvalidOutputError } = await import("@/lib/ai/research/pipeline");
      const err = new Stage2InvalidOutputError("元のsanitized reason", kind);
      const classified = classifyForWorkflowRetry(err);
      expect(deriveErrorKind(classified)).toBe(`fatal:stage2_invalid_output:${kind}`);
    });

    it("kind不明な旧形式(裸のstage2_invalid_output)も後方互換でfatal:stage2_invalid_outputになる", () => {
      expect(deriveErrorKind(new FatalError("Stage2の応答検証に失敗しました(stage2_invalid_output)"))).toBe(
        "fatal:stage2_invalid_output",
      );
    });
  });

  describe("Workflow error hydration境界での分類(SDK推奨の.is()移行、実機Preview検証、2026-08-07)", () => {
    // workflow公式ドキュメント(node_modules/workflow/docs/api-reference/workflow/fatal-error.mdx)が
    // 明記する通り、cross-realm(step再実行時の別実行コンテキスト)では`instanceof`は
    // prototype chainの不一致で失敗しうる。`FatalError.is()`/`RetryableError.is()`は
    // `name`プロパティ一致(`FatalError`はさらに`fatal:true`のduck typingも)で判定するため、
    // 別クラスとしてhydrateされた場合でも正しく分類できることを確認する。
    class RehydratedError extends Error {}

    it("instanceofでは検出できないhydrated FatalError相当でも.is()経由でfatal分類される", () => {
      const hydrated = Object.assign(
        new RehydratedError("Stage2の応答検証に失敗しました(stage2_invalid_output:coverage)"),
        { name: "FatalError", fatal: true },
      );
      expect(hydrated instanceof FatalError).toBe(false);
      expect(deriveErrorKind(hydrated)).toBe("fatal:stage2_invalid_output:coverage");
    });

    it("instanceofでは検出できないhydrated RetryableError相当でも.is()経由でretryable_exhausted分類される", () => {
      const hydrated = Object.assign(
        new RehydratedError("Gemini呼出が一時的に失敗しました(api_error:503)。1回だけ再試行します。"),
        { name: "RetryableError" },
      );
      expect(hydrated instanceof RetryableError).toBe(false);
      expect(deriveErrorKind(hydrated)).toBe("retryable_exhausted:api_error:503");
    });

    it("fatal:trueだけを持つ非FatalErrorクラスもFatalErrorとしてduck typing判定される(SerializationError等のSDK内部挙動と同じ契約)", () => {
      const hydrated = Object.assign(new RehydratedError("Gemini呼出が認証エラーで失敗しました(auth_error)"), {
        fatal: true,
      });
      expect(hydrated instanceof FatalError).toBe(false);
      expect(deriveErrorKind(hydrated)).toBe("fatal:auth_error");
    });
  });
});
