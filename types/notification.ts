/**
 * アプリ内通知型 (auth-and-notifications spec, Issue #16)
 *
 * テーブル本体および UI (通知ベル) は別仕様 (#14) が所有する。本仕様では:
 * - `user_id` カラム追加責務
 * - 「ベルが本人通知のみ表示する」フィルタ契約
 * のみを担う。本ファイルは #14 と整合する暫定形を提供する。
 *
 * カラム構成は #14 の最終確定スキーマに合わせて調整される可能性がある。
 */

/**
 * 通知種別。#14 / #43 の発火イベントに合わせて拡張される。
 * 本仕様では値の妥当性をアプリ層で担保 (DB は text として保持)。
 *
 * - `research_job_completed` / `research_job_failed`: #16 由来 (旧 Resend 通知。
 *   現状未使用だが型互換性のため残存)
 * - `deep_research_*`: #43 deep-research-pipeline で追加
 */
export type NotificationKind =
  | "research_job_completed"
  | "research_job_failed"
  | "deep_research_done"
  | "deep_research_failed"
  | "deep_research_budget_warning";

export interface Notification {
  readonly id: string;
  /** 通知先ユーザー (本仕様で追加するカラム)。NULL は「全員向け」として扱える余地を残す。 */
  readonly user_id: string | null;
  readonly kind: NotificationKind;
  readonly title: string;
  readonly body: string;
  /** 関連する店舗 / 商談 / ジョブなどへのリンク先 (任意)。 */
  readonly link_url: string | null;
  readonly read_at: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

/**
 * 通知作成時の入力型。`user_id` は呼び出し側が必ず特定して渡す責務 (Req 7.2)。
 */
export type NotificationInput = Omit<
  Notification,
  "id" | "created_at" | "updated_at" | "read_at"
>;
