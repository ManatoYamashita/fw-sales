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
