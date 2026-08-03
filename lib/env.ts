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
 * AI 店舗調査(`lib/ai/research/`, Issue #158, Plan v3.2)で使う Gemini モデル名。
 * 既定値は `getGeminiModel()` と同じ `gemini-3.6-flash` だが、独立した
 * `RESEARCH_GEMINI_MODEL` で上書きできる。営業資産生成(`GEMINI_MODEL`)と
 * Web調査を意図的に別の切り戻し経路にしている: tools(Google Search/URL Context)を
 * 使う調査フローは営業資産生成より挙動が変わりやすいため、片方だけを個別に
 * ロールバックできるようにする。
 */
export function getResearchGeminiModel(): string {
  return readEnv("RESEARCH_GEMINI_MODEL", getGeminiModel()) ?? getGeminiModel();
}

/**
 * AI 店舗調査の1回の生成で許す出力トークン上限。
 *
 * 営業資産生成(`MAX_OUTPUT_TOKENS = 4096`, `lib/ai/client.ts`)より大きい既定値
 * (16384)を設定する。Stage2はFACT/FACT_OR_HEARING/ANALYSIS計42項目を1回の
 * Structured Output応答で返す(fix/ai-research-poc-like-retrieval でFACT/ANALYSIS
 * 2call構成から単一callへ統合)。Gemini 3系はthinkingが既定で有効で、thinking
 * tokenもこの出力枠を消費するため、実機smoke testで
 * `thoughtsTokenCount + candidatesTokenCount` が8192の上限にほぼ到達し
 * (8185/8192)、JSON出力が打ち切られ Stage2 全体が失敗する事象を確認した
 * (2026-08-03 Preview smoke test)。この実測を踏まえ8192→16384へ引き上げる。
 * `RESEARCH_MAX_OUTPUT_TOKENS` で上書き可能。
 */
export function getResearchMaxOutputTokens(): number {
  return readPositiveInt("RESEARCH_MAX_OUTPUT_TOKENS", 16384);
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

/**
 * 正の整数を環境変数から読み出す。不正値 (非数値・負・0) はデフォルトにフォールバック。
 */
function readPositiveInt(key: string, fallback: number): number {
  const raw = readEnv(key);
  if (raw === undefined) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}
