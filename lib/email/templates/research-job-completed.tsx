/**
 * 調査ジョブ完了通知メールテンプレート (auth-and-notifications spec, Issue #16)
 *
 * #14 のジョブワーカーが `status: 'completed'` 遷移時に呼び出す。
 *
 * - 件名: `エリア調査ジョブ完了 (成功 N 件 / 失敗 M 件)`
 * - 本文: 対象店舗一覧 + `/stores` 一覧画面リンク (Req 5.4, 5.5)
 *
 * 関連: design.md §「lib/email/templates」, requirements.md §5.2, §5.4, §5.5
 */

import "server-only";
import type { Profile } from "@/types/profile";
import type { EmailMessage } from "@/lib/email/client";
import { EmailLayout, EMAIL_COLORS, renderEmail } from "./_layout";

export interface ResearchJobSummary {
  readonly target_count: number;
  readonly completed_count: number;
  readonly failed_count: number;
  readonly target_stores: readonly { readonly id: string; readonly name: string }[];
}

export interface ResearchJobCompletedInput {
  readonly profile: Profile;
  readonly job: ResearchJobSummary;
  readonly appBaseUrl: string;
}

function ResearchJobCompletedBody({
  profile,
  job,
  appBaseUrl,
}: ResearchJobCompletedInput) {
  const storesUrl = `${appBaseUrl}/stores`;
  return (
    <EmailLayout
      heading="エリア調査ジョブが完了しました"
      preheader={`成功 ${job.completed_count} 件 / 失敗 ${job.failed_count} 件 (対象 ${job.target_count} 件)`}
    >
      <p style={{ margin: "0 0 12px" }}>{profile.display_name} さん</p>
      <p style={{ margin: "0 0 16px" }}>
        起動された調査ジョブが完了しました。集計結果は以下のとおりです。
      </p>
      <table
        role="presentation"
        width="100%"
        cellPadding={0}
        cellSpacing={0}
        style={{
          margin: "0 0 16px",
          border: `1px solid ${EMAIL_COLORS.border}`,
          borderCollapse: "collapse",
          fontSize: 14,
        }}
      >
        <tbody>
          <tr>
            <td style={{ padding: "8px 12px", borderBottom: `1px solid ${EMAIL_COLORS.border}` }}>
              対象件数
            </td>
            <td
              style={{
                padding: "8px 12px",
                borderBottom: `1px solid ${EMAIL_COLORS.border}`,
                textAlign: "right",
              }}
            >
              {job.target_count}
            </td>
          </tr>
          <tr>
            <td style={{ padding: "8px 12px", borderBottom: `1px solid ${EMAIL_COLORS.border}` }}>
              成功
            </td>
            <td
              style={{
                padding: "8px 12px",
                borderBottom: `1px solid ${EMAIL_COLORS.border}`,
                textAlign: "right",
                color: EMAIL_COLORS.accent,
                fontWeight: 600,
              }}
            >
              {job.completed_count}
            </td>
          </tr>
          <tr>
            <td style={{ padding: "8px 12px" }}>失敗</td>
            <td
              style={{
                padding: "8px 12px",
                textAlign: "right",
                color: job.failed_count > 0 ? EMAIL_COLORS.warning : EMAIL_COLORS.muted,
                fontWeight: 600,
              }}
            >
              {job.failed_count}
            </td>
          </tr>
        </tbody>
      </table>
      {job.target_stores.length > 0 ? (
        <>
          <p style={{ margin: "16px 0 8px", fontWeight: 600 }}>対象店舗</p>
          <ul style={{ margin: "0 0 16px", paddingLeft: 20 }}>
            {job.target_stores.map((s) => (
              <li key={s.id} style={{ marginBottom: 4 }}>
                {s.name}
              </li>
            ))}
          </ul>
        </>
      ) : null}
      <p style={{ margin: "16px 0 8px" }}>
        詳細は店舗一覧画面でご確認ください:
      </p>
      <p style={{ margin: 0 }}>
        <a
          href={storesUrl}
          style={{
            display: "inline-block",
            padding: "8px 16px",
            backgroundColor: EMAIL_COLORS.accent,
            color: "#ffffff",
            textDecoration: "none",
            borderRadius: 6,
            fontWeight: 600,
            fontSize: 14,
          }}
        >
          店舗一覧を開く
        </a>
      </p>
    </EmailLayout>
  );
}

export async function buildResearchJobCompletedEmail(
  input: ResearchJobCompletedInput,
): Promise<EmailMessage> {
  const subject = `エリア調査ジョブ完了 (成功 ${input.job.completed_count} 件 / 失敗 ${input.job.failed_count} 件)`;
  const html = await renderEmail(<ResearchJobCompletedBody {...input} />);
  const text = [
    `${input.profile.display_name} さん`,
    "",
    "起動された調査ジョブが完了しました。",
    `対象 ${input.job.target_count} 件 / 成功 ${input.job.completed_count} 件 / 失敗 ${input.job.failed_count} 件`,
    "",
    ...(input.job.target_stores.length > 0
      ? [
          "対象店舗:",
          ...input.job.target_stores.map((s) => `- ${s.name}`),
          "",
        ]
      : []),
    `店舗一覧: ${input.appBaseUrl}/stores`,
  ].join("\n");
  return {
    to: input.profile.email,
    subject,
    html,
    text,
  };
}
