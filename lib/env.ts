/**
 * 環境変数バリデーションヘルパ。
 *
 * 用途: DB 接続情報など必須の環境変数が起動時に揃っているか検証する。
 * - `assertEnv(key)`: 値が無ければ throw、あれば trim 済みの値を返す。
 * - `readEnv(key, fallback?)`: 任意キー用。未設定または空文字なら fallback を返す。
 *
 * 制約:
 * - エラーメッセージにはキー名のみを含め、値そのものはログに出さない (機密保護)。
 * - `import "server-only"` を付けない: scripts/seed.ts など Node 単体スクリプト
 *   からも import される想定のため。純粋ヘルパ関数として副作用を持たない。
 *
 * 関連: design.md §「`lib/env.ts` (assertEnv)」, requirements.md §6.1, §6.3
 */

/**
 * 必須環境変数を取得する。値が未設定または空文字なら例外を throw する。
 *
 * @param key - 取得する環境変数のキー名
 * @returns trim 済みの値
 * @throws {Error} キーが未設定または空文字の場合
 */
export function assertEnv(key: string): string {
  const raw = process.env[key];
  if (raw === undefined) {
    throw new Error(`Missing required env: ${key}`);
  }
  const trimmed = raw.trim();
  if (trimmed === "") {
    throw new Error(`Missing required env: ${key}`);
  }
  return trimmed;
}

/**
 * 任意環境変数を取得する。値が未設定または空文字なら fallback を返す。
 *
 * @param key - 取得する環境変数のキー名
 * @param fallback - 値が無いときに返すデフォルト値 (省略時は undefined)
 * @returns trim 済みの値、もしくは fallback
 */
export function readEnv(key: string, fallback?: string): string | undefined {
  const raw = process.env[key];
  if (raw === undefined) {
    return fallback;
  }
  const trimmed = raw.trim();
  if (trimmed === "") {
    return fallback;
  }
  return trimmed;
}

/**
 * Gemini API キーが設定済みかを返す (boolean のみ、値そのものは返さない)。
 *
 * 用途: Server Component から取得した結果を Client Component に props で渡し、
 * `[AI で分析]` ボタンの disabled 状態を制御する (Req 2.7)。
 *
 * 注意: API キーの実値は本関数では返さない。実値の取得は `lib/ai/client.ts`
 * (`import "server-only"` 隔離) の内部でのみ行うこと。
 */
export function isApiKeyConfigured(): boolean {
  return readEnv("GEMINI_API_KEY") !== undefined;
}

/**
 * 営業資産生成で使う Gemini モデル名を返す。未設定時のデフォルトは `gemini-3.6-flash`。
 *
 * 既定値の変更経緯 (2026-07):
 * - 旧既定 `gemini-2.5-flash` は Google 公式に deprecated であり、**シャットダウン日は
 *   2026-10-16**。放置すると営業資産生成が本番で停止するため、公式推奨後継である
 *   `gemini-3.6-flash` (GA) へ既定値を移した。
 *
 * `GEMINI_MODEL` による上書きは維持する。これは単なる設定項目ではなく **切り戻し経路**
 * そのものである:
 * - 品質が期待に届かない → `GEMINI_MODEL=gemini-3.5-flash` (GA・同世代)
 * - レイテンシ/コストが重い → `GEMINI_MODEL=gemini-3.5-flash-lite` (GA・低レイテンシ低コスト)
 *
 * **切り戻し先に deprecated な旧モデル (`gemini-2.5-*`) を指定しないこと。**
 * 2026-10-16 に必ず停止するため、問題を先送りするだけで解決にならない。
 *
 * 注意: Vercel 等で `GEMINI_MODEL` が明示設定されている環境では、本関数の既定値を
 * 変えても挙動は変わらない。移行時は各環境の env を必ず確認すること
 * (`docs/gemini-model-migration-runbook.md`)。
 */
export function getGeminiModel(): string {
  return readEnv("GEMINI_MODEL", "gemini-3.6-flash") ?? "gemini-3.6-flash";
}

/**
 * AI 店舗調査 run (`store_research_runs`) の `expires_at` マージン(分)。
 *
 * `started_at` からこの分数後を stuck run 検出の参考値とする(AI 店舗調査再設計
 * Plan v3.2 §17)。PoC実測(約3分23秒)に対する暫定値であり、実運用のばらつきを
 * 見て調整する前提のため、コード直書きの magic number ではなく env で上書き
 * 可能にする。未設定時のデフォルトは 10 分。
 *
 * 旧 `DEEP_RESEARCH_*` 系(このファイル下部)とは無関係の新設定。撤去済み
 * Deep Research パイプラインの再利用ではない。
 */
export function getResearchRunExpiresMarginMinutes(): number {
  return readPositiveInt("RESEARCH_RUN_EXPIRES_MARGIN_MINUTES", 10);
}

/**
 * Google Places API キーが設定済みかを返す (boolean のみ、値そのものは返さない)。
 *
 * 用途: Server Component から取得した結果を Client Component に props で渡し、
 * エリア検索ボタンの disabled 状態を制御する。
 *
 * 注意: API キーの実値は本関数では返さない。実値の取得は `lib/places/google.ts`
 * (`import "server-only"` 隔離) の内部でのみ行うこと。
 */
export function isPlacesApiKeyConfigured(): boolean {
  return readEnv("GOOGLE_PLACES_API_KEY") !== undefined;
}

// ---------------------------------------------------------------------------
// deep-research-pipeline spec (Issue #43)
// ---------------------------------------------------------------------------

/**
 * Deep Research (Stage 1) で使用する Gemini モデル名を返す。
 * 未設定時のデフォルトは `deep-research-preview-04-2026`。
 *
 * Phase 0 PoC で実体のモデル ID 表記を確認後、必要なら本関数のデフォルト値か
 * 環境変数 `DEEP_RESEARCH_MODEL` を更新する。
 */
export function getDeepResearchModel(): string {
  return (
    readEnv("DEEP_RESEARCH_MODEL", "deep-research-preview-04-2026") ??
    "deep-research-preview-04-2026"
  );
}

/**
 * Stage 2 構造化で使用する Gemini モデル名を返す。
 * 未設定時のデフォルトは `gemini-2.5-flash-lite`。
 */
export function getStructurerModel(): string {
  return (
    readEnv("DEEP_RESEARCH_STRUCTURER_MODEL", "gemini-2.5-flash-lite") ??
    "gemini-2.5-flash-lite"
  );
}

/**
 * Stage 2 構造化 (Gemini) の `maxOutputTokens` 上限。
 * `full_markdown` を出力スキーマから除外したため通常は十分だが、tier=B の
 * `source_quote` 長文化などに備えた余裕として env で調整可能にする (再デプロイ不要)。
 * 未設定時のデフォルトは 16384。
 */
export function getStructurerMaxOutputTokens(): number {
  return readPositiveInt("DEEP_RESEARCH_STRUCTURER_MAX_TOKENS", 16384);
}

/**
 * GitHub Actions cron から `/api/cron/poll-research` を叩く際の共有シークレット。
 * 必須環境変数。未設定なら throw する (運用 misconfig を起動時に検出)。
 */
export function assertCronSecret(): string {
  return assertEnv("CRON_SECRET");
}

/**
 * 同時に in-flight (researching + structuring) に置けるジョブ数の上限。
 * 未設定時のデフォルトは 10。1 cron tick で新規 Stage 1 を起動するかどうかの判定に使う。
 */
export function getInFlightCap(): number {
  return readPositiveInt("DEEP_RESEARCH_MAX_IN_FLIGHT", 10);
}

/**
 * 1 cron tick あたりに polling で叩く `researching` ジョブの最大件数。
 * 未設定時のデフォルトは 5。
 */
export function getPollPerTick(): number {
  return readPositiveInt("DEEP_RESEARCH_POLL_PER_TICK", 5);
}

/**
 * 1 ユーザーあたり 1 暦日に登録可能なジョブ件数の上限。
 * 未設定時のデフォルトは 30。Action 層で `countByUserSinceDay` と比較する。
 */
export function getDailyUserCap(): number {
  return readPositiveInt("DEEP_RESEARCH_DAILY_USER_CAP", 30);
}

/**
 * 1 月あたりの総ジョブ実行件数の上限。コスト枯渇防止。
 * 未設定時のデフォルトは 1000。Action 層で `countByMonth` と比較する。
 */
export function getMonthlyCap(): number {
  return readPositiveInt("DEEP_RESEARCH_MONTHLY_CAP", 1000);
}

/**
 * Stage 1 進捗停滞 (stall) 検知のしきい値 (ミリ秒)。
 * `researching` のまま Google 側 `api_updated_at` がこの時間以上更新されなければ停滞とみなす。
 * env は分単位 (`DEEP_RESEARCH_STALL_THRESHOLD_MIN`)、未設定時のデフォルトは 90 分。
 * 誤検知が出た場合はこの値を大きくするだけで stall sweep を即時無効化できる (再デプロイ不要)。
 */
export function getStallThresholdMs(): number {
  return readPositiveInt("DEEP_RESEARCH_STALL_THRESHOLD_MIN", 90) * 60_000;
}

/**
 * Stage 1 進捗停滞検知の grace period (ミリ秒)。
 * `research_started_at` がこの時間以上前のジョブのみを stall 検知対象とし、
 * 起動直後 (初回ポーリング 45 分前) の誤検知を防ぐ。
 * env は分単位 (`DEEP_RESEARCH_STALL_GRACE_MIN`)、未設定時のデフォルトは 60 分。
 */
export function getStallGraceMs(): number {
  return readPositiveInt("DEEP_RESEARCH_STALL_GRACE_MIN", 60) * 60_000;
}

/**
 * 月次警告閾値 (上限の何 % を超えたら admin 通知を出すか)。
 * 未設定時のデフォルトは 80。0-100 の整数。
 */
export function getMonthlyWarningPercent(): number {
  const raw = readPositiveInt("DEEP_RESEARCH_MONTHLY_WARNING_PERCENT", 80);
  if (raw > 100) return 100;
  return raw;
}

/**
 * 正の整数を環境変数から読み出す。不正値 (非数値・負・0) はデフォルトにフォールバック。
 *
 * Deep Research の運用設定値は全て正の整数で表現できるため、専用ヘルパとして集約する。
 */
function readPositiveInt(key: string, fallback: number): number {
  const raw = readEnv(key);
  if (raw === undefined) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}
