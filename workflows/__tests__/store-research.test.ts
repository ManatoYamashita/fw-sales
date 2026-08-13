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
  STAGE0_PLACES_TIMEOUT_MS,
  RETRYABLE_SANITIZED_KINDS,
  type RetryableSanitizedKind,
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

/**
 * F2(PR #180 final merge-blocker fix)のため、`repos.researchRun` は
 * 制御可能な mock にする。CAS(`updateIfRunning`)の戻り値で
 * 「running のまま」「既に terminal」を表現する。
 */
const mockResearchRun = vi.hoisted(() => ({
  updateIfRunning: vi.fn(),
  get: vi.fn(),
  update: vi.fn(),
}));
vi.mock("@/lib/repositories", () => ({
  repos: { researchRun: mockResearchRun, store: { get: vi.fn() } },
}));
vi.mock("@/lib/ai/research/pipeline", () => ({
  runStage1: vi.fn(),
  runStage2: vi.fn(),
  buildNonAiItems: vi.fn(),
  buildDeterministicItems: vi.fn(),
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
vi.mock("@/lib/ai/research/official-alias", () => ({
  resolveOfficialAliases: vi.fn(),
}));

const {
  classifyForWorkflowRetry,
  deriveErrorKind,
  buildFailureRecord,
  extractFailureTokenUsage,
  writeRunningRun,
  persistSucceededRun,
  persistFailedRun,
  RunSupersededError,
  isRunSupersededError,
} = await import(
  "../store-research"
);

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

  describe("非AiClientError fallbackのsanitization(runtime reliability hardening、F1の前提条件)", () => {
    // 旧実装は `new FatalError(err.message)` で raw message を FatalError へ引き継いでいた。
    // この状態で「FatalError内のsanitized tokenがretryable集合ならretryable_exhausted」
    // という判定(F1)を足すと、raw messageに偶然 `(rate_limit)` 等が含まれていた場合に
    // retry exhaustionでないFatalErrorを誤分類しうる。fallbackを固定文言にすることで
    // 「FatalError内にretryable tokenがある ⟺ SDKがretry exhaustion後にwrapした」
    // という不変条件を成立させる。
    it("raw messageをFatalErrorへ引き継がず、定型のsanitized文言のみになる", () => {
      const result = classifyForWorkflowRetry(
        new Error("connect ECONNREFUSED 10.0.0.7:5432 user=svc_prod token=abc123"),
      );
      expect(result.message).toBe("Gemini呼出が失敗しました(unknown)");
      expect(result.message).not.toContain("ECONNREFUSED");
      expect(result.message).not.toContain("svc_prod");
      expect(result.message).not.toContain("abc123");
    });

    it("非Errorのthrow値も同じsanitized文言になる", () => {
      expect(classifyForWorkflowRetry("文字列でthrow").message).toBe(
        "Gemini呼出が失敗しました(unknown)",
      );
    });

    it.each(["rate_limit", "timeout", "network_error", "api_error:503"])(
      "raw messageに(%s)が含まれていてもretryable_exhaustedへ誤分類せずfatal:unknownになる",
      (token) => {
        const classified = classifyForWorkflowRetry(
          new Error(`internal parser failed near marker (${token}) while decoding`),
        );
        expect(deriveErrorKind(classified)).toBe("fatal:unknown");
        expect(classified.message).not.toContain(token);
      },
    );
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

  // PR #180 final smoke hardening: Stage1 prompt へ mandatory な検索試行の指示を追加し、
  // conflict candidate の trust 検証を追加したが、いずれも既存 prompt / 既存 deterministic
  // validation の内部で完結する。Gemini provider call 数は Stage1 + Stage2 の 2 回のまま
  // でなければならない(検索クエリ数が増えることと provider call が増えることは別)。
  it("通常runのGemini provider call数は2(Stage1 + Stage2)のまま", () => {
    expect(GEMINI_STAGE_COUNT).toBe(2);
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

  // runtime reliability hardening: Stage0 に明示 timeout(STAGE0_PLACES_TIMEOUT_MS)を
  // 導入したが、これは latency 改善であって budget 削減ではない。AbortSignal は fetch
  // のみを縛り、DNS 前段の遅延・body 読み出し・JSON parse・step の enqueue 遅延は
  // 縛らないため、expires budget は引き続き platform 上限で保守的に見積もる。
  // 安全下限(30分)を下げると正常runのstuck誤判定→二重runのリスクが上がる。
  it("Stage0 timeout導入後もStage0 budgetはplatform上限のままで、安全下限は30分を割らない", () => {
    expect(getSafeExpiryBudgetBreakdownMs().stage0).toBe(
      PLATFORM_STEP_TIMEOUT_MS * (STAGE0_MAX_RETRIES + 1),
    );
    expect(STAGE0_PLACES_TIMEOUT_MS).toBeLessThan(PLATFORM_STEP_TIMEOUT_MS);
    expect(MIN_SAFE_EXPIRES_MARGIN_MINUTES).toBe(30);
  });
});

/**
 * 監査指摘 3: `markFailedStep` が `err.message` をそのまま
 * `store_research_runs.error_message` へ保存していた。Gemini 経路は
 * `classifyForWorkflowRetry` で sanitize されるが、DB step の失敗は
 * SDK wrapper 経由で **Postgres/Neon の生メッセージ**が入りうる。
 *
 * さらに research detail page は `StoreResearchRun[]` を Client Component へ渡すため、
 * UI で非表示でも `error_message` は RSC payload としてブラウザへ送られる。
 * そこで永続化する文言自体を固定文言にする。
 *
 * 診断の Source of Truth は `error_kind`(sanitized token)と structured log が担う。
 */
describe("buildFailureRecord (永続化する失敗レコードのsanitization、監査指摘 3)", () => {
  const FIXED_MESSAGE = "AI店舗調査に失敗しました";

  it("どんなerrorでもerror_messageは固定文言になる", () => {
    expect(buildFailureRecord(new Error("x")).error_message).toBe(FIXED_MESSAGE);
    expect(buildFailureRecord("plain string").error_message).toBe(FIXED_MESSAGE);
    expect(buildFailureRecord(null).error_message).toBe(FIXED_MESSAGE);
  });

  it("DB由来の生エラーメッセージを保存しない", () => {
    const raw =
      'Step "markStageStep" failed after 1 retry: connection to server at "ep-x.neon.tech" (10.0.0.7), port 5432 failed: FATAL: password authentication failed for user "svc_prod"';
    const record = buildFailureRecord(new FatalError(raw));
    expect(record.error_message).toBe(FIXED_MESSAGE);
    for (const secret of ["neon.tech", "10.0.0.7", "svc_prod", "password authentication"]) {
      expect(record.error_message).not.toContain(secret);
    }
  });

  it("provider由来の生メッセージ・request ID・API keyを保存しない", () => {
    const raw =
      '{"error":{"code":429,"message":"quota exceeded","status":"RESOURCE_EXHAUSTED"}} key=AIzaSyFAKEKEY123 requestId=8f3c1d2e-aaaa';
    const record = buildFailureRecord(new FatalError(raw));
    expect(record.error_message).toBe(FIXED_MESSAGE);
    for (const secret of ["AIzaSyFAKEKEY123", "8f3c1d2e", "quota exceeded", "RESOURCE_EXHAUSTED"]) {
      expect(record.error_message).not.toContain(secret);
    }
  });

  it("storeIdなど外部値を埋め込んだFatalErrorのmessageも保存しない(follow-up候補 A の実害を先に閉じる)", () => {
    const record = buildFailureRecord(new FatalError("店舗が見つかりません: store-abc-123"));
    expect(record.error_message).toBe(FIXED_MESSAGE);
    expect(record.error_message).not.toContain("store-abc-123");
  });

  it("error_kindは従来どおりsanitized tokenを保持する(診断のSource of Truthは維持)", () => {
    const retryable = classifyForWorkflowRetry({ kind: "rate_limit" } as AiClientError);
    expect(
      buildFailureRecord(new FatalError(`Step "stage1Step" failed after 1 retry: ${retryable.message}`))
        .error_kind,
    ).toBe("retryable_exhausted:rate_limit");
    expect(
      buildFailureRecord(classifyForWorkflowRetry({ kind: "auth_error" } as AiClientError)).error_kind,
    ).toBe("fatal:auth_error");
    expect(buildFailureRecord(new Error("x")).error_kind).toBe("unknown");
  });
});

describe("RETRYABLE_SANITIZED_KINDS の drift ガード(runtime reliability hardening、F1)", () => {
  // `deriveErrorKind` は「FatalError の message に含まれる token がこの集合に属するなら
  // SDK による retry exhaustion wrap」と判定する。したがってこの定数が
  // `classifyForWorkflowRetry` の RetryableError 分岐と 1 対 1 で対応していることが
  // 不変条件になる。Record<RetryableSanitizedKind, ...> の網羅性により、token を
  // 追加した場合は fixture 追加を型が強制する。
  const FIXTURE_BY_TOKEN: Record<RetryableSanitizedKind, AiClientError> = {
    rate_limit: { kind: "rate_limit" },
    timeout: { kind: "timeout" },
    network_error: { kind: "network_error" },
    "api_error:503": { kind: "api_error", status: 503 },
  };

  it("各tokenは実際にRetryableErrorへ分類されるkindである", () => {
    for (const token of RETRYABLE_SANITIZED_KINDS) {
      const classified = classifyForWorkflowRetry(FIXTURE_BY_TOKEN[token]);
      expect(classified, `${token} は RetryableError であるべき`).toBeInstanceOf(RetryableError);
      expect(classified.message).toContain(`(${token})`);
    }
  });

  it("RetryableErrorになるkindの数は GEMINI_RETRY_AFTER_MS のキー数と一致する", () => {
    expect(RETRYABLE_SANITIZED_KINDS.length).toBe(Object.keys(GEMINI_RETRY_AFTER_MS).length);
  });

  it("retryしないkindのtokenは1つもこの集合に含まれない", () => {
    const nonRetryable: AiClientError[] = [
      { kind: "auth_error" },
      { kind: "missing_api_key" },
      { kind: "max_tokens" },
      { kind: "api_error", status: 400 },
      { kind: "api_error", status: 404 },
      { kind: "api_error", status: 500 },
      { kind: "unknown", message: "x" },
    ];
    for (const err of nonRetryable) {
      const classified = classifyForWorkflowRetry(err);
      expect(classified).toBeInstanceOf(FatalError);
      for (const token of RETRYABLE_SANITIZED_KINDS) {
        expect(classified.message).not.toContain(`(${token})`);
      }
    }
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

  describe("Workflow SDKのretry exhaustion wrapper(runtime reliability hardening、F1)", () => {
    /**
     * `@workflow/core` 5.0.0-beta.38 の step-executor は、retry 上限に達した step の
     * 元エラーを**新しい `FatalError` でラップ**する(installed dist で確認:
     * `node_modules/.pnpm/@workflow+core@5.0.0-beta.38_ws@8.20.0/node_modules/@workflow/core/
     * dist/runtime/step-executor.js:786-794`)。
     *
     *   const errorMessage = `Step "${stepName}" failed after ${maxRetries} retry: ${元message}`;
     *   const wrappedError = new FatalError(errorMessage);
     *   wrappedError.cause = err;
     *
     * このため、我々が `RetryableError` として投げたものも workflow の catch には
     * `FatalError` として届く。旧実装では `deriveErrorKind` の `RetryableError.is()`
     * 分岐が本番で到達不能となり、一時的障害も恒久的障害も `fatal:*` に潰れていた
     * (実障害の観測値 `error_kind = 'fatal:rate_limit'` がこの経路の証拠)。
     */
    function wrapAsRetryExhausted(inner: Error, stepName = "stage1Step"): Error {
      return new FatalError(`Step "${stepName}" failed after 1 retry: ${inner.message}`);
    }

    it.each<[string, AiClientError]>([
      ["rate_limit", { kind: "rate_limit" }],
      ["timeout", { kind: "timeout" }],
      ["network_error", { kind: "network_error" }],
      ["api_error:503", { kind: "api_error", status: 503 }],
    ])("SDKがwrapした%sはretryable_exhausted:<token>として復元される", (token, err) => {
      const wrapped = wrapAsRetryExhausted(classifyForWorkflowRetry(err));
      expect(FatalError.is(wrapped)).toBe(true);
      expect(deriveErrorKind(wrapped)).toBe(`retryable_exhausted:${token}`);
    });

    it.each<[string, AiClientError]>([
      ["auth_error", { kind: "auth_error" }],
      ["missing_api_key", { kind: "missing_api_key" }],
      ["max_tokens", { kind: "max_tokens" }],
      ["api_error:404", { kind: "api_error", status: 404 }],
      ["unknown", { kind: "unknown", message: "x" }],
    ])("retryしない%sはwrapされてもfatal:<token>のままである", (token, err) => {
      const wrapped = wrapAsRetryExhausted(classifyForWorkflowRetry(err), "stage2Step");
      expect(deriveErrorKind(wrapped)).toBe(`fatal:${token}`);
    });

    it("final_result_invalidはretryable集合に含まれずfatalのままである", () => {
      const wrapped = wrapAsRetryExhausted(
        new FatalError("最終結果の整合性検証に失敗しました(final_result_invalid)"),
      );
      expect(deriveErrorKind(wrapped)).toBe("fatal:final_result_invalid");
    });

    /**
     * 監査指摘 B: retryable token だけを message 全体から探すと、DB step 等の raw error が
     * SDK に wrap された際に偶然同じ token を含むと誤分類しうる
     * (`loadStoreStep` / `markStageStep` 等は `classifyForWorkflowRetry` を通さないため、
     * Postgres/Neon の生メッセージがそのまま wrapper message に入る)。
     *
     * そこで retry exhaustion の判定は、**我々が生成する RetryableError の自前定型文**に
     * anchor する。SDK の英語 wrapper prefix にも `err.cause` にも依存しない。
     */
    describe("自前テンプレートへのanchor(監査指摘 B)", () => {
      it("FatalError内に単なる(timeout)があるだけではretry exhausted扱いしない", () => {
        expect(deriveErrorKind(new FatalError("何らかの処理が (timeout) で終了しました"))).toBe(
          "fatal:timeout",
        );
      });

      it.each(["rate_limit", "timeout", "network_error", "api_error:503"])(
        "DB step由来のraw messageがSDKにwrapされ(%s)を含んでもretry exhausted扱いしない",
        (token) => {
          // `markStageStep` 等は classifyForWorkflowRetry を通さないため、Postgres の
          // 生メッセージがそのまま SDK wrapper message に入りうる形を模す。
          const wrapped = new FatalError(
            `Step "markStageStep" failed after 1 retry: canceling statement due to (${token}) at neon-proxy`,
          );
          expect(deriveErrorKind(wrapped)).toBe(`fatal:${token}`);
        },
      );

      it("自前テンプレートを含む場合のみretryable_exhaustedになる", () => {
        const ours = classifyForWorkflowRetry({ kind: "rate_limit" } as AiClientError);
        // 定型文まるごとを含む(SDK wrap 相当)
        expect(
          deriveErrorKind(new FatalError(`Step "stage1Step" failed after 1 retry: ${ours.message}`)),
        ).toBe("retryable_exhausted:rate_limit");
        // token だけ(定型文なし)
        expect(deriveErrorKind(new FatalError("(rate_limit)"))).toBe("fatal:rate_limit");
      });

      it.each<[string, () => Error]>([
        ["fatal:auth_error", () => classifyForWorkflowRetry({ kind: "auth_error" } as AiClientError)],
        ["fatal:max_tokens", () => classifyForWorkflowRetry({ kind: "max_tokens" } as AiClientError)],
        [
          "fatal:stage2_invalid_output:schema",
          () => new FatalError("Stage2の応答検証に失敗しました(stage2_invalid_output:schema)"),
        ],
        [
          "fatal:final_result_invalid",
          () => new FatalError("最終結果の整合性検証に失敗しました(final_result_invalid)"),
        ],
      ])("anchor導入後も%sの分類は変わらない", (expected, make) => {
        expect(deriveErrorKind(make())).toBe(expected);
        // SDK に wrap されても同じ
        expect(
          deriveErrorKind(new FatalError(`Step "stage2Step" failed after 1 retry: ${make().message}`)),
        ).toBe(expected);
      });
    });

    it("hydrate後(plain object相当)のwrapped FatalErrorでも復元できる", () => {
      const hydrated = Object.assign(
        new Error('Step "stage1Step" failed after 1 retry: Gemini呼出が一時的に失敗しました(rate_limit)。1回だけ再試行します。'),
        { name: "FatalError", fatal: true },
      );
      expect(hydrated instanceof FatalError).toBe(false);
      expect(deriveErrorKind(hydrated)).toBe("retryable_exhausted:rate_limit");
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

/**
 * MAX_TOKENS 時の token_usage 永続化
 * (feat/ai-research-quality-ux-hardening、Plan §11.2 / Theme 5B)。
 *
 * `store_research_runs.token_usage` は jsonb なので **migration 不要**。
 * `StoreResearchRunPatch` には既に `token_usage` が含まれている。
 *
 * ## 入力は「`classifyForWorkflowRetry` が付けた cause」だけ(最終レビュー指摘)
 *
 * `markFailedStep` が受け取るのは step 境界を越えてきた `FatalError` であり、
 * 生の `AiClientError` ではない。したがって `extractFailureTokenUsage` は
 * **`err.cause` の厳格な shape guard を通った payload のみ**を受け付ける。
 * 生 `AiClientError` を直接渡す経路は意図的に廃止した(guard を通らない入力を
 * 受け入れる口を残さないため)。
 */
describe("extractFailureTokenUsage (Theme 5B)", () => {
  const USAGE = {
    promptTokenCount: 5344,
    candidatesTokenCount: 6177,
    toolUsePromptTokenCount: 83456,
    thoughtsTokenCount: 18500,
    totalTokenCount: 113477,
  };

  /** 本番と同じ経路(`classifyForWorkflowRetry` が cause を付ける)で入力を作る。 */
  function maxTokensError(usage?: Record<string, unknown>): Error {
    return classifyForWorkflowRetry({ kind: "max_tokens", usage } as AiClientError);
  }

  it("max_tokensエラーのusageをStage2分として取り出す", () => {
    expect(extractFailureTokenUsage(maxTokensError(USAGE), null)).toEqual({ stage2: USAGE });
  });

  it("Stage1のusageも同時に保存する(Stage2失敗でStage1分まで消えないようにする)", () => {
    const stage1 = { ...USAGE, totalTokenCount: 999 };
    expect(extractFailureTokenUsage(maxTokensError(USAGE), stage1)).toEqual({
      stage1,
      stage2: USAGE,
    });
  });

  it("usageが無いmax_tokensではstage2を含めない", () => {
    expect(extractFailureTokenUsage(maxTokensError(undefined), null)).toBeNull();
  });

  it("max_tokens以外のエラーではStage1分だけを保存する", () => {
    const stage1 = { ...USAGE };
    const authError = classifyForWorkflowRetry({ kind: "auth_error" } as AiClientError);
    expect(extractFailureTokenUsage(authError, stage1)).toEqual({ stage1 });
    expect(extractFailureTokenUsage(authError, null)).toBeNull();
  });

  it("AiClientError以外(DB step失敗等)でもStage1分があれば保存する", () => {
    const stage1 = { ...USAGE };
    expect(extractFailureTokenUsage(new Error("db down"), stage1)).toEqual({ stage1 });
    expect(extractFailureTokenUsage(new Error("db down"), null)).toBeNull();
  });

  /**
   * Stage1 diagnostics の失敗時 persistence(PR #180)。
   *
   * 実機で Stage2 が `api_error:400` で落ちた際、`token_usage` に `stage1` しか残らず、
   * Stage1 完了時点で確定していた 5 つの diagnostics(検索回数・食べログ観測)が
   * すべて失われていた。原因は `stage1_diagnostics` が `persistSucceededStep` の
   * 呼び出し内でのみ inline 構築されていたこと。成功/失敗で同じ object を使う。
   *
   * 保存するのは count と boolean のみで、raw URL / query / text は含まない。
   */
  describe("stage1_diagnostics の失敗時 persistence", () => {
    const DIAGNOSTICS = {
      search_call_count: 3,
      search_query_count: 12,
      tabelog_search_attempted: true,
      tabelog_source_emitted: false,
      tabelog_source_block_mentions_domain: false,
    };

    it("23. Stage1完了後にStage2がapi_error:400で落ちてもstage1/stage1_diagnosticsを保存する", () => {
      const stage1 = { ...USAGE };
      const apiError = classifyForWorkflowRetry({
        kind: "api_error",
        status: 400,
      } as AiClientError);
      expect(extractFailureTokenUsage(apiError, stage1, DIAGNOSTICS)).toEqual({
        stage1,
        stage1_diagnostics: DIAGNOSTICS,
      });
    });

    it("24. Stage2がmax_tokensの場合はstage1 / stage1_diagnostics / stage2をすべて残す", () => {
      const stage1 = { ...USAGE, totalTokenCount: 999 };
      expect(extractFailureTokenUsage(maxTokensError(USAGE), stage1, DIAGNOSTICS)).toEqual({
        stage1,
        stage1_diagnostics: DIAGNOSTICS,
        stage2: USAGE,
      });
    });

    it("25. Stage1完了前の失敗ではstage1_diagnosticsを作らない(0埋めの捏造をしない)", () => {
      const apiError = classifyForWorkflowRetry({
        kind: "api_error",
        status: 400,
      } as AiClientError);
      expect(extractFailureTokenUsage(apiError, null, null)).toBeNull();
      // Stage1 usage だけある(diagnostics 未確定)状態でも捏造しない。
      const stage1 = { ...USAGE };
      const result = extractFailureTokenUsage(apiError, stage1, null);
      expect(result).toEqual({ stage1 });
      expect(result).not.toHaveProperty("stage1_diagnostics");
    });

    it("27. 保存される diagnostics に raw URL / query / text が含まれない", () => {
      const stage1 = { ...USAGE };
      const serialized = JSON.stringify(
        extractFailureTokenUsage(new Error("db down"), stage1, DIAGNOSTICS),
      );
      expect(serialized).not.toContain("tabelog.com");
      expect(serialized).not.toContain("なむら");
      expect(serialized).not.toContain("[SOURCE]");
      expect(serialized).not.toContain("http");
      for (const value of Object.values(DIAGNOSTICS)) {
        expect(["number", "boolean"]).toContain(typeof value);
      }
    });

    it("28. 第3引数を省略した既存呼び出しは従来どおり動作する(後方互換)", () => {
      const stage1 = { ...USAGE };
      expect(extractFailureTokenUsage(maxTokensError(USAGE), stage1)).toEqual({
        stage1,
        stage2: USAGE,
      });
      expect(extractFailureTokenUsage(new Error("db down"), null)).toBeNull();
    });
  });

  it("生のAiClientErrorを直接渡してもstage2を採用しない(guard必須、最終レビュー指摘)", () => {
    // `markFailedStep` に届くのは常に cause 付きの FatalError。guard を通らない
    // 入力から usage を拾う裏口を残さない。
    expect(
      extractFailureTokenUsage({ kind: "max_tokens", usage: USAGE } as AiClientError, null),
    ).toBeNull();
  });

  it("保存する値は数値のみ(raw message等を含めない)", () => {
    const result = extractFailureTokenUsage(maxTokensError(USAGE), null);
    for (const v of Object.values(result!.stage2 as Record<string, unknown>)) {
      expect(typeof v === "number" || v === null).toBe(true);
    }
  });
});

describe("MAX_TOKENS usage の end-to-end 伝播 (Theme 5B / 最終レビュー指摘)", () => {
  const STAGE2_USAGE = {
    promptTokenCount: 5344,
    candidatesTokenCount: 6177,
    toolUsePromptTokenCount: 83456,
    thoughtsTokenCount: 18500,
    totalTokenCount: 113477,
  };
  const STAGE1_USAGE = {
    promptTokenCount: 1200,
    candidatesTokenCount: 800,
    toolUsePromptTokenCount: 0,
    thoughtsTokenCount: 400,
    totalTokenCount: 2400,
  };

  /**
   * Workflow step 境界の serialization を **再帰的に**再現する。
   *
   * - native Error(`FatalError` 含む)→ `{ (name,) message, stack, cause }` だけを
   *   引き継いだ新インスタンスへ。**独自プロパティは捨てる。**
   * - plain object / 配列 → own enumerable プロパティを再帰的にコピー(devalue 相当)
   * - primitive → そのまま
   *
   * これにより「cause が Error subclass だと独自プロパティが消える」という
   * 実 serializer の性質がテスト上でも再現される。
   */
  function simulateStepBoundary(value: unknown): unknown {
    if (value instanceof Error) {
      const revived =
        value.name === "FatalError" ? new FatalError(value.message) : new Error(value.message);
      revived.name = value.name;
      revived.stack = value.stack;
      if ("cause" in value) {
        revived.cause = simulateStepBoundary((value as { cause?: unknown }).cause);
      }
      return revived;
    }
    if (Array.isArray(value)) return value.map(simulateStepBoundary);
    if (typeof value === "object" && value !== null) {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value)) out[k] = simulateStepBoundary(v);
      return out;
    }
    return value;
  }

  function crossBoundary(err: Error): Error {
    return simulateStepBoundary(err) as Error;
  }

  it("simulateStepBoundary 自体の妥当性: Error subclass の独自プロパティは失われる", () => {
    // このメタテストが緑でないと、以降のテストは実 serializer を再現できていない。
    class LegacyAiError extends Error {
      usage = STAGE2_USAGE;
      constructor() {
        super("legacy");
        this.name = "LegacyAiError";
      }
    }
    const before = new LegacyAiError();
    expect(before.usage).toEqual(STAGE2_USAGE);

    const after = simulateStepBoundary(before) as { usage?: unknown };
    expect(after).toBeInstanceOf(Error);
    expect(after.usage).toBeUndefined();
  });

  it("旧方式(cause = Error subclass の AiClientError 相当)ではusageが消える", () => {
    // 「AiClientError を Error subclass にする」将来のリファクタで壊れることの再現。
    class ErrorLikeAiClientError extends Error {
      kind = "max_tokens";
      usage = STAGE2_USAGE;
      constructor() {
        super("");
        this.name = "ErrorLikeAiClientError";
      }
    }
    const fatal = new FatalError("Gemini呼出が失敗しました(max_tokens)");
    fatal.cause = new ErrorLikeAiClientError();

    const crossed = crossBoundary(fatal);

    expect((crossed.cause as { usage?: unknown }).usage).toBeUndefined();
    // 旧方式のまま plain-object 前提の guard を通しても拾えない = stage2 が欠ける
    expect(extractFailureTokenUsage(crossed, STAGE1_USAGE)).toEqual({ stage1: STAGE1_USAGE });
  });

  it("新方式(cause = sanitized plain object)はserialization往復後もusageが残る", () => {
    const aiError = { kind: "max_tokens", usage: STAGE2_USAGE } as AiClientError;
    const classified = classifyForWorkflowRetry(aiError);

    // cause は plain object であって Error ではない
    const cause = (classified as { cause?: unknown }).cause as Record<string, unknown>;
    expect(cause).not.toBeInstanceOf(Error);
    expect(cause.kind).toBe("max_tokens_usage");

    const crossed = crossBoundary(classified);
    expect(extractFailureTokenUsage(crossed, null)).toEqual({ stage2: STAGE2_USAGE });
  });

  it("end-to-end: MAX_TOKENS → classify → step境界 → error_kind と stage1/stage2 が揃う", () => {
    const aiError = { kind: "max_tokens", usage: STAGE2_USAGE } as AiClientError;

    const classified = classifyForWorkflowRetry(aiError);
    expect(FatalError.is(classified)).toBe(true);

    const crossed = crossBoundary(classified);

    const failure = buildFailureRecord(crossed);
    const tokenUsage = extractFailureTokenUsage(crossed, STAGE1_USAGE);

    expect(failure.error_kind).toBe("fatal:max_tokens");
    expect(failure.error_message).toBe("AI店舗調査に失敗しました");
    expect(tokenUsage).not.toBeNull();
    expect(tokenUsage!.stage1).toEqual(STAGE1_USAGE);
    expect(tokenUsage!.stage2).toEqual(STAGE2_USAGE);
  });

  it("causeが失われても error_kind は fatal:max_tokens のまま(safe degrade)", () => {
    const fatal = new FatalError("Gemini呼出が失敗しました(max_tokens)");
    const crossed = crossBoundary(fatal);

    expect(deriveErrorKind(crossed)).toBe("fatal:max_tokens");
    expect(extractFailureTokenUsage(crossed, STAGE1_USAGE)).toEqual({ stage1: STAGE1_USAGE });
  });

  it("usage が無い max_tokens では cause を付けず、stage1 だけを保存する", () => {
    const aiError = { kind: "max_tokens" } as AiClientError;
    const classified = classifyForWorkflowRetry(aiError);

    expect((classified as { cause?: unknown }).cause).toBeUndefined();
    expect(extractFailureTokenUsage(crossBoundary(classified), STAGE1_USAGE)).toEqual({
      stage1: STAGE1_USAGE,
    });
  });
});

describe("MAX_TOKENS cause の shape guard (最終レビュー指摘)", () => {
  const STAGE1_USAGE = {
    promptTokenCount: 1,
    candidatesTokenCount: 2,
    toolUsePromptTokenCount: 3,
    thoughtsTokenCount: 4,
    totalTokenCount: 5,
  };

  function withCauseValue(cause: unknown): Error {
    const fatal = new FatalError("Gemini呼出が失敗しました(max_tokens)");
    fatal.cause = cause;
    return fatal;
  }

  it("allowlist外のキーを含む usage は payload 全体を拒否する", () => {
    const err = withCauseValue({
      kind: "max_tokens_usage",
      usage: { candidate: "secret", promptTokenCount: 10 },
    });
    expect(extractFailureTokenUsage(err, null)).toBeNull();
  });

  it("数値でない値(文字列)を含む usage は拒否する", () => {
    const err = withCauseValue({
      kind: "max_tokens_usage",
      usage: { promptTokenCount: "AIzaSyFAKEKEY" },
    });
    expect(extractFailureTokenUsage(err, null)).toBeNull();
  });

  it("NaN / Infinity は拒否する", () => {
    expect(
      extractFailureTokenUsage(
        withCauseValue({ kind: "max_tokens_usage", usage: { promptTokenCount: Number.NaN } }),
        null,
      ),
    ).toBeNull();
    expect(
      extractFailureTokenUsage(
        withCauseValue({
          kind: "max_tokens_usage",
          usage: { promptTokenCount: Number.POSITIVE_INFINITY },
        }),
        null,
      ),
    ).toBeNull();
  });

  it("kind が違う plain object は採用しない", () => {
    const err = withCauseValue({ kind: "something_else", usage: { promptTokenCount: 10 } });
    expect(extractFailureTokenUsage(err, null)).toBeNull();
  });

  it("raw string / Error / provider 風オブジェクトは usage として採用しない", () => {
    expect(extractFailureTokenUsage(withCauseValue("promptTokenCount=10"), null)).toBeNull();
    expect(extractFailureTokenUsage(withCauseValue(new Error("boom")), null)).toBeNull();
    expect(
      extractFailureTokenUsage(
        withCauseValue({
          status: 429,
          message: '{"error":{"code":429,"status":"RESOURCE_EXHAUSTED"}}',
        }),
        null,
      ),
    ).toBeNull();
  });

  it("配列 / null / usage 空オブジェクト は拒否する", () => {
    expect(extractFailureTokenUsage(withCauseValue([1, 2, 3]), null)).toBeNull();
    expect(extractFailureTokenUsage(withCauseValue(null), null)).toBeNull();
    expect(
      extractFailureTokenUsage(withCauseValue({ kind: "max_tokens_usage", usage: {} }), null),
    ).toBeNull();
    expect(
      extractFailureTokenUsage(withCauseValue({ kind: "max_tokens_usage", usage: [] }), null),
    ).toBeNull();
  });

  it("null 値の token count は有効な値として受け付ける(取得できなかったフィールド)", () => {
    const err = withCauseValue({
      kind: "max_tokens_usage",
      usage: { promptTokenCount: 10, thoughtsTokenCount: null },
    });
    expect(extractFailureTokenUsage(err, null)).toEqual({
      stage2: { promptTokenCount: 10, thoughtsTokenCount: null },
    });
  });

  it("MAX_TOKENS以外(auth_error / rate_limit)には stage2 usage を付与しない", () => {
    for (const kind of ["auth_error", "rate_limit", "network_error"] as const) {
      const classified = classifyForWorkflowRetry({ kind } as AiClientError);
      expect((classified as { cause?: unknown }).cause).toBeUndefined();
      expect(extractFailureTokenUsage(classified, STAGE1_USAGE)).toEqual({
        stage1: STAGE1_USAGE,
      });
    }
  });

  it("保存される stage2 は数値と null のみ(raw が混ざらない)", () => {
    const aiError = {
      kind: "max_tokens",
      usage: {
        promptTokenCount: 5344,
        candidatesTokenCount: 6177,
        toolUsePromptTokenCount: 83456,
        thoughtsTokenCount: 18500,
        totalTokenCount: 113477,
      },
    } as AiClientError;
    const tokenUsage = extractFailureTokenUsage(classifyForWorkflowRetry(aiError), null);
    const serialized = JSON.stringify(tokenUsage);
    expect(serialized).not.toContain("Gemini");
    expect(serialized).not.toContain("http");
    for (const v of Object.values(tokenUsage!.stage2 as Record<string, unknown>)) {
      expect(typeof v === "number" || v === null).toBe(true);
    }
  });

  it("AiClientError の usage に余計なキーがあっても cause には載せない", () => {
    const aiError = {
      kind: "max_tokens",
      usage: {
        promptTokenCount: 10,
        // 型上はありえないが、将来フィールドが増えた場合に素通ししないことを固定する。
        rawResponse: "SECRET",
      },
    } as unknown as AiClientError;
    const classified = classifyForWorkflowRetry(aiError);

    expect(JSON.stringify((classified as { cause?: unknown }).cause)).not.toContain("SECRET");
    expect(extractFailureTokenUsage(classified, null)).toEqual({
      stage2: { promptTokenCount: 10 },
    });
  });
});

/* ------------------------------------------------------------------ */
/*  F2: terminal immutability / Workflow ownership                     */
/*  (PR #180 final merge-blocker fix)                                  */
/* ------------------------------------------------------------------ */

/**
 * ## 何を固定するか
 *
 * `startResearchRunAction` は expires_at を過ぎた running run を
 * `failed / stuck_run_timeout` へ倒してから新しい run を作る。この時点で旧 Workflow が
 * 生きていると、旧 Workflow の DB step が terminal な run を書き換えられた
 * (監査 F2、CONFIRMED)。特に `persistSucceededStep` は `status: "succeeded"` を
 * 無条件に書くため failed が succeeded へ**復活**し、復活した run は
 * `listStoreIdsNeedingReview` に載って review の一括採用で canonical へ入りえた。
 *
 * 本 describe は「terminal になった run へは Workflow から一切書けない」ことを、
 * status だけでなく stage / source_registry / result / token_usage / error_* まで
 * 含めて固定する。
 *
 * mock の `updateIfRunning` は CAS の結果そのものを表現する:
 * - 非 null = `status = 'running'` だったので更新できた
 * - null    = 0行更新(run 不存在 / terminal)なので**1列も書いていない**
 */
describe("F2: Workflow 由来 write の CAS(terminal immutability)", () => {
  const RUN_ID = "research_run_old";

  function makeRun(overrides: Record<string, unknown> = {}) {
    return {
      id: RUN_ID,
      store_id: "store_1",
      status: "running",
      stage: "discovering",
      result: null,
      source_registry: [],
      review_decisions: {},
      review_completed_at: null,
      token_usage: null,
      warnings: [],
      error_kind: null,
      error_message: null,
      started_at: "2026-08-13T00:00:00.000Z",
      expires_at: "2026-08-13T00:30:00.000Z",
      finished_at: null,
      ...overrides,
    };
  }

  const succeededParams = {
    items: [],
    sourceRegistry: [],
    tokenUsage: { stage1: null },
    warnings: [],
  };

  beforeEach(() => {
    mockResearchRun.updateIfRunning.mockReset();
    mockResearchRun.get.mockReset();
    mockResearchRun.update.mockReset();
  });

  describe("RunSupersededError", () => {
    it("FatalError.is() が true(step retry を消費させない)", () => {
      expect(FatalError.is(new RunSupersededError())).toBe(true);
    });

    it("RetryableError.is() は false(provider の一時エラーとして扱わない)", () => {
      expect(RetryableError.is(new RunSupersededError())).toBe(false);
    });

    it("message に runId・店舗情報・raw data を含まない(固定文言のみ)", () => {
      const message = new RunSupersededError().message;
      expect(message).not.toContain(RUN_ID);
      expect(message).not.toContain("store_1");
      expect(message).toContain("superseded");
    });

    it("isRunSupersededError は name で cross-realm 判定する", () => {
      expect(isRunSupersededError(new RunSupersededError())).toBe(true);
      const hydrated = new Error("x");
      hydrated.name = "RunSupersededError";
      expect(isRunSupersededError(hydrated)).toBe(true);
      expect(isRunSupersededError(new Error("x"))).toBe(false);
    });

    it("error_kind は sanitized token を持たない(retry exhausted と誤分類されない)", () => {
      expect(deriveErrorKind(new RunSupersededError())).toBe("fatal");
    });
  });

  describe("writeRunningRun(markStageStep / resolveAndPersistSourceRegistryStep の実体)", () => {
    it("13. running run への write は成功し、通常の Workflow 挙動を変えない", async () => {
      mockResearchRun.updateIfRunning.mockResolvedValue(makeRun({ stage: "researching" }));

      await expect(writeRunningRun(mockResearchRun, RUN_ID, { stage: "researching" })).resolves.toBeUndefined();

      expect(mockResearchRun.updateIfRunning).toHaveBeenCalledWith(RUN_ID, {
        stage: "researching",
      });
      expect(mockResearchRun.update).not.toHaveBeenCalled();
    });

    it("8. 遅れて届いた markStageStep は failed run を書き換えられない", async () => {
      mockResearchRun.updateIfRunning.mockResolvedValue(null);

      await expect(writeRunningRun(mockResearchRun, RUN_ID, { stage: "researching" })).rejects.toSatisfy(
        isRunSupersededError,
      );
      expect(mockResearchRun.update).not.toHaveBeenCalled();
    });

    it("9. 遅れて届いた Source Registry 永続化は failed run を書き換えられない", async () => {
      mockResearchRun.updateIfRunning.mockResolvedValue(null);

      await expect(writeRunningRun(mockResearchRun, RUN_ID, { source_registry: [] })).rejects.toSatisfy(
        isRunSupersededError,
      );
      expect(mockResearchRun.update).not.toHaveBeenCalled();
    });

    it("CAS miss は非 running への write を1回も再試行しない(単発で throw する)", async () => {
      mockResearchRun.updateIfRunning.mockResolvedValue(null);

      await expect(writeRunningRun(mockResearchRun, RUN_ID, { stage: "done" })).rejects.toThrow();
      expect(mockResearchRun.updateIfRunning).toHaveBeenCalledTimes(1);
    });
  });

  describe("persistSucceededRun", () => {
    it("7. superseded された旧 run を succeeded へ復活させない(F2 の中核回帰テスト)", async () => {
      // 旧 run は stuck 判定で failed / stuck_run_timeout になっている。
      mockResearchRun.updateIfRunning.mockResolvedValue(null);
      mockResearchRun.get.mockResolvedValue(
        makeRun({ status: "failed", error_kind: "stuck_run_timeout", stage: "researching" }),
      );

      await expect(persistSucceededRun(mockResearchRun, RUN_ID, succeededParams)).rejects.toSatisfy(
        isRunSupersededError,
      );
      expect(mockResearchRun.update).not.toHaveBeenCalled();
    });

    it("running run なら succeeded を書き込み、確認の再readをしない", async () => {
      mockResearchRun.updateIfRunning.mockResolvedValue(
        makeRun({ status: "succeeded", stage: "done" }),
      );

      await expect(persistSucceededRun(mockResearchRun, RUN_ID, succeededParams)).resolves.toBeUndefined();

      const patch = mockResearchRun.updateIfRunning.mock.calls[0]![1] as Record<string, unknown>;
      expect(patch.status).toBe("succeeded");
      expect(patch.stage).toBe("done");
      expect(patch.finished_at).toEqual(expect.any(String));
      expect(mockResearchRun.get).not.toHaveBeenCalled();
    });

    it("12. DB commit 成功後の step retry は idempotent success として扱う", async () => {
      // 2回目の実行では自分が書いた succeeded/done が既に入っているため CAS miss になる。
      mockResearchRun.updateIfRunning.mockResolvedValue(null);
      mockResearchRun.get.mockResolvedValue(makeRun({ status: "succeeded", stage: "done" }));

      await expect(persistSucceededRun(mockResearchRun, RUN_ID, succeededParams)).resolves.toBeUndefined();
    });

    it("succeeded でも stage が done でなければ superseded として扱う(安全側)", async () => {
      mockResearchRun.updateIfRunning.mockResolvedValue(null);
      mockResearchRun.get.mockResolvedValue(makeRun({ status: "succeeded", stage: "researching" }));

      await expect(persistSucceededRun(mockResearchRun, RUN_ID, succeededParams)).rejects.toSatisfy(
        isRunSupersededError,
      );
    });

    it("run が消えている場合も superseded として扱う", async () => {
      mockResearchRun.updateIfRunning.mockResolvedValue(null);
      mockResearchRun.get.mockResolvedValue(null);

      await expect(persistSucceededRun(mockResearchRun, RUN_ID, succeededParams)).rejects.toSatisfy(
        isRunSupersededError,
      );
    });
  });

  describe("persistFailedRun", () => {
    it("running run には従来どおり failed / error_kind / token_usage を書き込む", async () => {
      mockResearchRun.updateIfRunning.mockResolvedValue(makeRun({ status: "failed" }));
      const err = new FatalError("Gemini呼出が失敗しました(auth_error)");

      await persistFailedRun(mockResearchRun, RUN_ID, err, { promptTokenCount: 1 } as never, null);

      const patch = mockResearchRun.updateIfRunning.mock.calls[0]![1] as Record<string, unknown>;
      expect(patch.status).toBe("failed");
      expect(patch.error_kind).toBe("fatal:auth_error");
      expect(patch.token_usage).toEqual({ stage1: { promptTokenCount: 1 } });
    });

    it("10. 遅れて届いた失敗記録は stuck_run_timeout を上書きしない", async () => {
      mockResearchRun.updateIfRunning.mockResolvedValue(null);

      await persistFailedRun(mockResearchRun, RUN_ID, new FatalError("Gemini呼出が失敗しました(auth_error)"));

      expect(mockResearchRun.update).not.toHaveBeenCalled();
      // CAS 経路以外から書き込む手段を持たないため、既存の error_kind は保持される。
      expect(mockResearchRun.updateIfRunning).toHaveBeenCalledTimes(1);
    });

    it("11. CAS miss でも throw しない(catch → 失敗記録 → 再throw の再帰を作らない)", async () => {
      mockResearchRun.updateIfRunning.mockResolvedValue(null);

      await expect(persistFailedRun(mockResearchRun, RUN_ID, new RunSupersededError())).resolves.toBeUndefined();
    });

    it("RunSupersededError を受け取っても失敗記録の書式は sanitized のまま", async () => {
      mockResearchRun.updateIfRunning.mockResolvedValue(makeRun({ status: "failed" }));

      await persistFailedRun(mockResearchRun, RUN_ID, new RunSupersededError());

      const patch = mockResearchRun.updateIfRunning.mock.calls[0]![1] as Record<string, unknown>;
      expect(patch.error_message).toBe("AI店舗調査に失敗しました");
      expect(String(patch.error_message)).not.toContain(RUN_ID);
      expect(String(patch.error_message)).not.toContain("superseded");
    });
  });

  describe("14. provider 呼出構成への影響が無いこと", () => {
    it("Gemini provider call 数(Stage1 + Stage2)は 2 のまま", () => {
      expect(GEMINI_STAGE_COUNT).toBe(2);
    });

    it("Gemini stage の maxRetries は変更していない", () => {
      expect(GEMINI_STAGE_MAX_RETRIES).toBe(1);
    });

    it("DB step の maxRetries は変更していない", () => {
      expect(DB_STEP_MAX_RETRIES).toBe(1);
    });

    it("RunSupersededError は retryable な sanitized kind に含まれない", () => {
      for (const token of RETRYABLE_SANITIZED_KINDS) {
        expect(new RunSupersededError().message).not.toContain(`(${token})`);
      }
    });

    it("safe expiry margin(30分)は変わらない", () => {
      expect(MIN_SAFE_EXPIRES_MARGIN_MINUTES).toBe(30);
    });
  });
});
