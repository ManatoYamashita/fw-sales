/**
 * 商談予定日リマインダーメールテンプレート (auth-and-notifications spec, Issue #16)
 *
 * Vercel Cron `/api/cron/deal-reminders` が前日朝 / 当日朝に呼び出す。
 *
 * - 件名: `明日の商談リマインダー (N 件)` または `本日の商談リマインダー (N 件)` (Req 6.5)
 * - 本文: 商談ごとに 店舗名・商談形式・提案内容・店舗詳細リンク (Req 6.6)
 *
 * 関連: design.md §「lib/email/templates」, requirements.md §6.5, §6.6
 */

import "server-only";
import type { Profile } from "@/types/profile";
import type { EmailMessage } from "@/lib/email/client";
import { EmailLayout, EMAIL_COLORS, renderEmail } from "./_layout";

export type DealReminderMode = "tomorrow" | "today";

export interface ReminderDealItem {
  readonly store_id: string;
  readonly store_name: string;
  readonly meeting_type: string;
  readonly proposal: string;
}

export interface DealReminderInput {
  readonly profile: Profile;
  readonly mode: DealReminderMode;
  readonly deals: readonly ReminderDealItem[];
  readonly appBaseUrl: string;
}

const MODE_LABEL: Record<DealReminderMode, string> = {
  tomorrow: "明日",
  today: "本日",
};

function DealReminderBody({
  profile,
  mode,
  deals,
  appBaseUrl,
}: DealReminderInput) {
  const label = MODE_LABEL[mode];
  return (
    <EmailLayout
      heading={`${label}の商談リマインダー (${deals.length} 件)`}
      preheader={`${label}は ${deals.length} 件の商談が予定されています`}
    >
      <p style={{ margin: "0 0 12px" }}>{profile.display_name} さん</p>
      <p style={{ margin: "0 0 16px" }}>
        {label}予定の商談をお知らせします。準備状況をご確認ください。
      </p>
      {deals.map((deal, index) => {
        const storeUrl = `${appBaseUrl}/stores/${deal.store_id}`;
        return (
          <table
            key={deal.store_id}
            role="presentation"
            width="100%"
            cellPadding={0}
            cellSpacing={0}
            style={{
              margin: index === 0 ? "0 0 12px" : "0 0 12px",
              border: `1px solid ${EMAIL_COLORS.border}`,
              borderRadius: 6,
              backgroundColor: "#fafafa",
              fontSize: 14,
            }}
          >
            <tbody>
              <tr>
                <td style={{ padding: "12px 14px 6px", fontWeight: 600 }}>
                  {deal.store_name}
                </td>
              </tr>
              <tr>
                <td style={{ padding: "0 14px 6px", color: EMAIL_COLORS.muted, fontSize: 13 }}>
                  形式: {deal.meeting_type}
                </td>
              </tr>
              <tr>
                <td style={{ padding: "0 14px 10px", fontSize: 13 }}>
                  <span style={{ color: EMAIL_COLORS.muted }}>提案: </span>
                  {deal.proposal || "(提案内容未入力)"}
                </td>
              </tr>
              <tr>
                <td style={{ padding: "0 14px 12px" }}>
                  <a
                    href={storeUrl}
                    style={{
                      color: EMAIL_COLORS.accent,
                      textDecoration: "none",
                      fontSize: 13,
                      fontWeight: 600,
                    }}
                  >
                    店舗詳細を開く →
                  </a>
                </td>
              </tr>
            </tbody>
          </table>
        );
      })}
    </EmailLayout>
  );
}

export function buildDealReminderEmail(
  input: DealReminderInput,
): EmailMessage {
  const label = MODE_LABEL[input.mode];
  const subject = `${label}の商談リマインダー (${input.deals.length} 件)`;
  const html = renderEmail(<DealReminderBody {...input} />);
  const text = [
    `${input.profile.display_name} さん`,
    "",
    `${label}予定の商談 ${input.deals.length} 件をお知らせします。`,
    "",
    ...input.deals.flatMap((deal) => [
      `■ ${deal.store_name}`,
      `  形式: ${deal.meeting_type}`,
      `  提案: ${deal.proposal || "(提案内容未入力)"}`,
      `  詳細: ${input.appBaseUrl}/stores/${deal.store_id}`,
      "",
    ]),
  ].join("\n");
  return {
    to: input.profile.email,
    subject,
    html,
    text,
  };
}
