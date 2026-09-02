/**
 * 診断ログへ載せる文字列の共通サニタイザ。
 *
 * 「UI へは sanitize 済み文言のみ / 診断情報は `console.error` の構造化ログへ」という
 * 二系統設計 (PR #144 以来の規約、`lib/security/safe-http-fetch.ts` 冒頭に詳述) の
 * うち、**ログ側**に載せる文字列を整えるための純関数だけを置く。
 *
 * `clipForLog` は元々 `lib/security/safe-http-fetch.ts` の module-private 実装だったが、
 * Places API のエラー本文 (Issue #201) でも同じ切り詰めが必要になったため、同じ処理を
 * 2 箇所に複製せずここへ集約した (PR #213 で SSRF 判定を `lib/security/url-safety.ts` へ
 * 一本化したのと同じ方針: 片方だけ直る事故を防ぐ)。
 *
 * サーバー専用の依存を持たない純粋な文字列関数のため `server-only` は付けない。
 */

/**
 * 診断ログへ載せる文字列フィールドの最大長 (#208 review)。
 *
 * redirect 先の `Location` ヘッダや外部 API のレスポンス本文はいずれも外部入力であり、
 * 長さに上限がない。ログ 1 行のサイズが外部入力に比例して膨らむ状態は避ける。
 */
export const LOG_FIELD_MAX_CHARS = 200;

/**
 * 診断ログ用に文字列を `LOG_FIELD_MAX_CHARS` で切り詰める。切り詰めた場合は元の長さを
 * 併記し、ログを読む側が「切り詰められた」ことと元のサイズを判別できるようにする。
 */
export function clipForLog(s: string): string {
  return s.length <= LOG_FIELD_MAX_CHARS
    ? s
    : `${s.slice(0, LOG_FIELD_MAX_CHARS)}…(${s.length})`;
}

/**
 * Google API キーの形状 (`AIza` + 35 文字の base64url 相当)。
 *
 * 本リポジトリの Google API キーはすべてリクエストヘッダ (`X-Goog-Api-Key`) か
 * クエリパラメータで送っており、レスポンス本文へ反響する API は確認されていない。
 * それでもログへ載せる文字列は外部が内容を制御しうるため、多層防御として落とす。
 */
const GOOGLE_API_KEY_PATTERN = /AIza[0-9A-Za-z_-]{35}/g;

/**
 * 診断ログへ載せる文字列から、秘匿値と判別できる部分文字列を伏せる。
 *
 * 「何かが伏せられた」ことがログから分かるよう、削除ではなく `[REDACTED]` へ置換する。
 * `clipForLog` と合成して使う場合は **redact を先に適用すること** (先に切り詰めると
 * キーの断片が末尾に残りうるため)。
 */
export function redactSecrets(s: string): string {
  return s.replace(GOOGLE_API_KEY_PATTERN, "[REDACTED]");
}
