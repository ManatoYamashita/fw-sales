/**
 * Deep Research 通知ヘルパ (deep-research-pipeline spec, Issue #43, Task 3.3)
 *
 * 3 種類の通知 kind を `notifications` テーブルに書き込む。スキーマ拡張は行わず、
 * 既存テーブルに新規 kind 値を追加するだけ (R7.4 担保)。
 *
 * - `deep_research_done`            : 対象店舗の登録ユーザー 1 名宛
 * - `deep_research_failed`          : 同上、失敗理由要約を body に含める
 * - `deep_research_budget_warning`  : `profiles.role = 'admin'` 全員へ fan-out
 *
 * 外部チャネル (Email / Slack / LINE) は本ファイルから一切呼ばない (R4.4 を
 * 構造的に担保)。
 *
 * 関連: design.md §Components and Interfaces / createDeepResearchNotification,
 *       requirements.md §4.1, §4.2, §4.4, §6.3, §7.4
 */

import "server-only";

import { revalidateTag } from "next/cache";
import { repos } from "@/lib/repositories";
import { CACHE_TAGS } from "@/lib/cache";
import type { Notification, NotificationInput } from "@/types/notification";

export interface DeepResearchDoneNotification {
  kind: "deep_research_done";
  storeId: string;
  storeName: string;
  jobId: string;
  /** 通知受信者の userId (ジョブ登録者) */
  userId: string;
}

export interface DeepResearchFailedNotification {
  kind: "deep_research_failed";
  storeId: string;
  storeName: string;
  jobId: string;
  userId: string;
  /** 失敗理由の 1〜2 行要約 (生のスタックトレースは含めないこと) */
  reasonSummary: string;
}

export interface DeepResearchBudgetWarningNotification {
  kind: "deep_research_budget_warning";
  /** 例: 80 — 月次上限の 80% を超えた閾値 */
  percent: number;
  /** 当月の実行件数 */
  currentCount: number;
  /** 月次上限 */
  monthlyCap: number;
}

export type DeepResearchNotificationInput =
  | DeepResearchDoneNotification
  | DeepResearchFailedNotification
  | DeepResearchBudgetWarningNotification;

/**
 * Deep Research 通知を作成する。kind に応じて単一 / fan-out が変わる。
 *
 * - `deep_research_done` / `deep_research_failed`: 1 行 insert (1 ユーザー宛)
 * - `deep_research_budget_warning`: 管理者全員に fan-out (admin が 0 人なら no-op)
 *
 * `notifications` テーブルへの書込後、`CACHE_TAGS.notifications` を revalidate して
 * `getRecentNotifications` (Task 3.4) の SWR を起こす。
 */
export async function createDeepResearchNotification(
  input: DeepResearchNotificationInput,
): Promise<readonly Notification[]> {
  const created: Notification[] = [];

  if (input.kind === "deep_research_done") {
    const created1 = await repos.notification.insert(
      buildDoneInput(input),
    );
    created.push(created1);
  } else if (input.kind === "deep_research_failed") {
    const created1 = await repos.notification.insert(
      buildFailedInput(input),
    );
    created.push(created1);
  } else {
    // budget_warning: admin 全員に fan-out
    const admins = await repos.profile.findAdmins();
    for (const admin of admins) {
      const row = await repos.notification.insert(
        buildBudgetWarningInput(input, admin.id),
      );
      created.push(row);
    }
  }

  if (created.length > 0) {
    revalidateTag(CACHE_TAGS.notifications, "max");
  }
  return created;
}

function buildDoneInput(
  input: DeepResearchDoneNotification,
): NotificationInput {
  return {
    user_id: input.userId,
    kind: "deep_research_done",
    title: `Deep Research が完了しました: ${input.storeName}`,
    body: `店舗「${input.storeName}」のレポートが生成されました。タブからご確認ください。`,
    link_url: `/stores/${input.storeId}#deep-research`,
  };
}

function buildFailedInput(
  input: DeepResearchFailedNotification,
): NotificationInput {
  // body はテンプレ + 要約。スタックトレース類は呼出側で予め除去済の想定
  return {
    user_id: input.userId,
    kind: "deep_research_failed",
    title: `Deep Research が失敗しました: ${input.storeName}`,
    body: `理由: ${truncate(input.reasonSummary, 200)}\n再投入が可能です。`,
    link_url: `/stores/${input.storeId}#deep-research`,
  };
}

function buildBudgetWarningInput(
  input: DeepResearchBudgetWarningNotification,
  adminUserId: string,
): NotificationInput {
  return {
    user_id: adminUserId,
    kind: "deep_research_budget_warning",
    title: `月次予算 ${input.percent}% に到達`,
    body: `Deep Research 当月実行 ${input.currentCount}/${input.monthlyCap} 件。上限に達すると新規登録が拒否されます。`,
    link_url: null,
  };
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}
