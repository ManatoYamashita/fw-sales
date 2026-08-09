/**
 * AI 店舗調査 run の timing / retry 構成の **Source of Truth**
 * (fix: PR #180 review Finding 3)。
 *
 * ## なぜ独立したモジュールなのか
 *
 * `store_research_runs.expires_at` のマージン(stuck run 判定に使う)は、Workflow が
 * 正常に走りきるのに要しうる時間より必ず長くなければならない。短いと、まだ処理中の
 * run が `isRunStuck` で stuck 扱いされ failed へ倒され、同一店舗の二重 run を招く。
 *
 * その計算には Workflow 側の timeout / retry 構成が必要だが、
 * `lib/env.ts → workflows/store-research.ts → lib/repositories → lib/db → lib/env.ts`
 * という循環 import になるため Workflow から直接は読めない。そこで **env / repository /
 * workflow のいずれにも依存しない純粋な定数モジュール**として切り出す。
 *
 * ## 使い方の約束
 *
 * Workflow 実装(`workflows/store-research.ts`)と安全 expiry 計算(`lib/env.ts` の
 * `getResearchRunExpiresMarginMinutes`)は、**必ず本モジュールの同じ定数を参照する**こと。
 * 片方だけにハードコードすると、将来 Workflow の timeout / retry だけが変更されたときに
 * expiry 計算との drift が発生し、Finding 3 と同じ不具合が再発する。
 * `workflows/__tests__/store-research.test.ts` に drift 検知テストを置いている。
 */

/** 1 stage あたりの Gemini 呼出 timeout。Hobby の個別 Function 上限(300秒)に収まる値。 */
export const GEMINI_STAGE_TIMEOUT_MS = 240_000;

/**
 * Gemini stage(Stage1 / Stage2)の retry 回数。`maxRetries = 1` は「1 回だけ再試行」
 * = 最大 2 attempt を意味する(`node_modules/workflow/docs/foundations/errors-and-retries.mdx`)。
 * Plan v3.2 §17 の retry 方針(429/503/timeout/network のみ最大1 retry)に対応する。
 */
export const GEMINI_STAGE_MAX_RETRIES = 1;

/** Gemini 呼出を行う stage 数(Stage1: Source Discovery / Stage2: URL Context + 構造化出力)。 */
export const GEMINI_STAGE_COUNT = 2;

/**
 * retry 種別ごとの待機時間。`RetryableError` の `retryAfter` は **ミリ秒数値**を
 * 受け付ける(`node_modules/workflow/docs/cookbook/common-patterns/rate-limiting.mdx:221`)
 * ため、`classifyForWorkflowRetry` はこの値をそのまま渡す。
 *
 * 値の根拠(実機Preview検証、2026-08-07。全種一律5sから種別ごとの回復特性に合わせ調整):
 * - `rate_limit`(429): レスポンス自体は即座に返るため待機を伸ばしても total への影響が小さい
 * - `service_unavailable`(api_error:503): 「過負荷は通常数分で解消」という Gemini 公式ガイド
 * - `timeout` / `network_error`: 一過性の接続断が主因のため短め
 */
export const GEMINI_RETRY_AFTER_MS = {
  rate_limit: 30_000,
  service_unavailable: 20_000,
  timeout: 10_000,
  network_error: 10_000,
} as const satisfies Record<string, number>;

/**
 * expiry budget の算定に使う最大 retry 待機。個々の値を手書きで二重管理せず
 * `GEMINI_RETRY_AFTER_MS` から導出する(種別を追加・変更しても自動追従する)。
 */
export const MAX_GEMINI_RETRY_AFTER_MS = Math.max(...Object.values(GEMINI_RETRY_AFTER_MS));

/**
 * Vercel Hobby の個別 Function 実行時間上限。**アプリ側に明示 timeout が無い step の
 * 実質的な上界**として使う(`workflows/store-research.ts` の設計コメント参照)。
 */
export const PLATFORM_STEP_TIMEOUT_MS = 300_000;

/**
 * Stage0(Google Places 軽量再同期)の retry 回数。best-effort のため 0
 * (`stage0PlacesStep.maxRetries = 0`)。
 */
export const STAGE0_MAX_RETRIES = 0;

/**
 * DB 書き込み/読み出しのみを行う step の数。
 * `loadStoreStep` / `markStageStep`×2 / `persistSourceRegistryStep` /
 * `persistSucceededStep` / `markFailedStep` の 6 つ。
 */
export const DB_STEP_COUNT = 6;

/** DB step の retry 回数(いずれも `maxRetries = 1`)。 */
export const DB_STEP_MAX_RETRIES = 1;

/**
 * DB step 1 attempt あたりに見込む許容時間。実測は通常ミリ秒オーダーだが、
 * Neon のコールドスタート・一時的な遅延を吸収できる保守的な値を置く。
 */
export const DB_STEP_BUDGET_MS = 15_000;

/**
 * step 1 attempt あたりの enqueue / dispatch 遅延の見込み。Workflow SDK は
 * 失敗後に即座に再 enqueue する("Steps get enqueued immediately after a failure")が、
 * step 間のキュー遅延自体はゼロではない。
 */
export const SCHEDULING_BUDGET_PER_ATTEMPT_MS = 10_000;

/** 上記見積りの誤差を吸収するための明示的な安全マージン。 */
export const EXPLICIT_SAFETY_MARGIN_MS = 120_000;

/** `computeMinimumSafeExpiryMs()` の内訳(テスト・運用時の説明用)。 */
export interface SafeExpiryBudgetBreakdownMs {
  /** Gemini stage の実行時間。`AbortSignal.timeout` で**強制される確定値**。 */
  gemini: number;
  /** Stage0。明示 timeout が無いため platform の step 上限で見積もる。 */
  stage0: number;
  /** DB step 群。 */
  dbSteps: number;
  /** step 間の enqueue / dispatch 遅延。 */
  scheduling: number;
  /** 明示的な安全マージン。 */
  safetyMargin: number;
}

export function getSafeExpiryBudgetBreakdownMs(): SafeExpiryBudgetBreakdownMs {
  const geminiAttemptsPerStage = GEMINI_STAGE_MAX_RETRIES + 1;
  const stage0Attempts = STAGE0_MAX_RETRIES + 1;
  const dbAttempts = DB_STEP_COUNT * (DB_STEP_MAX_RETRIES + 1);
  const totalStepAttempts = GEMINI_STAGE_COUNT * geminiAttemptsPerStage + stage0Attempts + dbAttempts;

  return {
    gemini:
      (GEMINI_STAGE_TIMEOUT_MS * geminiAttemptsPerStage +
        MAX_GEMINI_RETRY_AFTER_MS * GEMINI_STAGE_MAX_RETRIES) *
      GEMINI_STAGE_COUNT,
    stage0: PLATFORM_STEP_TIMEOUT_MS * stage0Attempts,
    dbSteps: dbAttempts * DB_STEP_BUDGET_MS,
    scheduling: totalStepAttempts * SCHEDULING_BUDGET_PER_ATTEMPT_MS,
    safetyMargin: EXPLICIT_SAFETY_MARGIN_MS,
  };
}

/**
 * 「正常に処理中の run を stuck と誤判定しない」ために必要な、**保守的な最小 expiry budget**
 * (ミリ秒)を返す。
 *
 * **これは実行時間の理論上界ではない。** 内訳のうち `AbortSignal` で強制される確定値は
 * Gemini stage 部分のみで、Stage0(明示 timeout 無し)・DB step・step 間の scheduling
 * 遅延には厳密な数学的上限が存在しない。それらは「この範囲を超えたら異常とみなしてよい」
 * という運用上の保守的見積りとして計上している。
 *
 * したがって本値の意味は「これより短い expiry を設定すると、正常 run を stuck と
 * 誤判定して二重 run を起こしうる下限」であり、`lib/env.ts` はこれを**下限**として扱う
 * (env による延長は許可し、短縮は clamp する)。
 */
export function computeMinimumSafeExpiryMs(): number {
  const b = getSafeExpiryBudgetBreakdownMs();
  return b.gemini + b.stage0 + b.dbSteps + b.scheduling + b.safetyMargin;
}

/**
 * `store_research_runs.expires_at` のマージンとして許容できる最小の分数。
 * `computeMinimumSafeExpiryMs()` を分単位へ切り上げたもの(現構成では 30 分)。
 */
export const MIN_SAFE_EXPIRES_MARGIN_MINUTES = Math.ceil(computeMinimumSafeExpiryMs() / 60_000);
