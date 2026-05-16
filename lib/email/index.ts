/**
 * `lib/email` バレル (auth-and-notifications spec, Issue #16)
 *
 * メール送信クライアントと 3 種テンプレートビルダの公開窓口。
 * 呼び出し側は本ファイル経由でのみアクセスし、内部リファクタを安全にする。
 *
 * 関連: design.md §「lib/email/index.ts」
 */

import "server-only";

export { emailClient, type EmailMessage, type EmailSendResult } from "./client";

export {
  buildResearchJobCompletedEmail,
  type ResearchJobCompletedInput,
  type ResearchJobSummary,
} from "./templates/research-job-completed";

export {
  buildResearchJobFailedEmail,
  type ResearchJobFailedInput,
} from "./templates/research-job-failed";

export {
  buildDealReminderEmail,
  type DealReminderInput,
  type DealReminderMode,
  type ReminderDealItem,
} from "./templates/deal-reminder";

export {
  sendResearchJobNotification,
  type ResearchJobNotificationInput,
  type ResearchJobNotificationKind,
} from "./research-job-notification";
