/**
 * Server Action が返す失敗の文のうち、クライアントが文面で結果を分岐するもの。
 *
 * `"use server"` のファイルは async 関数しか export できないため、ここに置いて
 * Action と呼び出し側の両方から読む。
 */

/** セッションが無いときの失敗の文。通知の既読化では、これを受けてもリンク先へ移る (#351)。 */
export const UNAUTHENTICATED_MESSAGE = "ログインが必要です";
