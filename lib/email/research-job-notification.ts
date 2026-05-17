/**
 * 調査ジョブ完了 / 失敗通知フック (auth-and-notifications spec, Issue #16)
 *
 * #14 (research-handoff-db-migration) のジョブワーカーが `store_research_jobs`
 * ステータスを `completed` / `failed` に遷移させる **直後** に呼び出すフック関数。
 *
 * 役割:
 * - `repos.profile.findById(job.triggered_by)` で受信者(起動ユーザ) を解決
 * - profile 不在 → error ログ + 静かに return (Req 5.7: 不明な受信者は無音で終了)
 * - kind に応じて `research-job-completed` / `research-job-failed` テンプレート → `emailClient.send()`
 *
 * 設計上の判断:
 * - `lib/jobs/research-worker.ts` への直接の挿入は #14 の責務。本仕様は **フック関数の
 *   提供のみ** に責任を限定し、`lib/email/index.ts` から re-export して
 *   `import { sendResearchJobNotification } from "@/lib/email"` で呼べる形にする。
 * - `triggered_by` 列名は Phase 2 完了後の最終形 (uuid)。Phase 1 中の `triggered_by_user_id`
 *   は #14 と協調して命名を統一する想定(本実装は Phase 2 後を前提)。
 *
 * 関連: design.md §「Job Hook(#14 連携)」, requirements.md §5.2, §5.3, §5.7
 */

import "server-only";
import { repos } from "@/lib/repositories";
import { emailClient } from "./client";
import {
  buildResearchJobCompletedEmail,
  type ResearchJobSummary,
} from "./templates/research-job-completed";
import { buildResearchJobFailedEmail } from "./templates/research-job-failed";

export type ResearchJobNotificationKind = "completed" | "failed";

/**
 * #14 の `store_research_jobs` 行を最低限抽象化したフック入力型。
 * #14 側 worker は自前のジョブ型からこの形に整形して渡す責務を持つ。
 */
export interface ResearchJobNotificationInput {
  /** 起動ユーザ profile.id (uuid)。Phase 2 後の `store_research_jobs.triggered_by`。 */
  readonly triggered_by: string;
  /** 集計 (件数 + 対象店舗一覧)。`completed` / `failed` 共通で利用。 */
  readonly summary: ResearchJobSummary;
  /** `failed` 時のみ参照される主要エラー要約 (1〜3 行)。`completed` 時は空文字 OK。 */
  readonly errorSummary?: string;
}

/**
 * メール本文の店舗詳細リンク生成用ベース URL。
 * 未設定時は dev フォールバック (`http://localhost:3000`)。
 */
function getAppBaseUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
}

/**
 * ジョブ完了 / 失敗時に呼び出すフック。
 *
 * **throw しない**: 受信者解決失敗 / メール送信失敗は内部でログ記録し、return する。
 * これは #14 ワーカー側でジョブの主要処理 (DB ステータス更新) を完了させた後に
 * 呼ぶ前提で、メール処理の失敗がジョブ全体の失敗を引き起こさないようにするため。
 */
export async function sendResearchJobNotification(
  job: ResearchJobNotificationInput,
  kind: ResearchJobNotificationKind,
): Promise<void> {
  const profile = await repos.profile.findById(job.triggered_by);
  if (!profile) {
    console.error(
      `[research-job-notification] profile not found for triggered_by=${job.triggered_by}, skipping ${kind} email send.`,
    );
    return;
  }

  const appBaseUrl = getAppBaseUrl();
  const message =
    kind === "completed"
      ? await buildResearchJobCompletedEmail({
          profile,
          job: job.summary,
          appBaseUrl,
        })
      : await buildResearchJobFailedEmail({
          profile,
          job: {
            target_count: job.summary.target_count,
            completed_count: job.summary.completed_count,
            failed_count: job.summary.failed_count,
          },
          errorSummary: job.errorSummary ?? "",
          appBaseUrl,
        });

  const result = await emailClient.send(message);
  if (result.kind === "failed") {
    console.error(
      `[research-job-notification] send failed for triggered_by=${job.triggered_by} kind=${kind}:`,
      result.error,
    );
  }
}
