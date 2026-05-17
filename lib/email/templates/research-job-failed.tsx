/**
 * 調査ジョブ失敗通知メールテンプレート (auth-and-notifications spec, Issue #16)
 *
 * #14 のジョブワーカーが `status: 'failed'` 遷移時に呼び出す。
 *
 * - 件名: `エリア調査ジョブが失敗しました`
 * - 本文: 失敗概要 (対象 / 失敗件数 / 主要エラー要約) + 再実行案内 (Req 5.6)
 *
 * 関連: design.md §「lib/email/templates」, requirements.md §5.3, §5.6
 */

import "server-only";
import type { Profile } from "@/types/profile";
import type { EmailMessage } from "@/lib/email/client";
import { EmailLayout, EMAIL_COLORS, renderEmail } from "./_layout";

export interface ResearchJobFailedInput {
  readonly profile: Profile;
  readonly job: {
    readonly target_count: number;
    readonly completed_count: number;
    readonly failed_count: number;
  };
  /** 主要エラーの要約 (1〜3 行程度) */
  readonly errorSummary: string;
  readonly appBaseUrl: string;
}

function ResearchJobFailedBody({
  profile,
  job,
  errorSummary,
  appBaseUrl,
}: ResearchJobFailedInput) {
  const storesUrl = `${appBaseUrl}/stores`;
  return (
    <EmailLayout
      heading="エリア調査ジョブが失敗しました"
      preheader={`失敗 ${job.failed_count} 件 (対象 ${job.target_count} 件) — 再実行を検討してください`}
    >
      <p style={{ margin: "0 0 12px" }}>{profile.display_name} さん</p>
      <p style={{ margin: "0 0 16px" }}>
        起動された調査ジョブが失敗のステータスで終了しました。
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
                color: EMAIL_COLORS.muted,
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
                color: EMAIL_COLORS.warning,
                fontWeight: 600,
              }}
            >
              {job.failed_count}
            </td>
          </tr>
        </tbody>
      </table>
      <p style={{ margin: "16px 0 8px", fontWeight: 600 }}>失敗の概要</p>
      <pre
        style={{
          margin: "0 0 16px",
          padding: 12,
          backgroundColor: "#fef2f2",
          border: `1px solid ${EMAIL_COLORS.warning}33`,
          borderRadius: 6,
          color: EMAIL_COLORS.text,
          fontSize: 13,
          fontFamily:
            "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
        }}
      >
        {errorSummary}
      </pre>
      <p style={{ margin: "16px 0 8px", fontWeight: 600 }}>再実行のご案内</p>
      <ul style={{ margin: "0 0 16px", paddingLeft: 20 }}>
        <li style={{ marginBottom: 4 }}>
          一時的なネットワークエラーや外部 API のレート制限が原因の場合があります。時間を置いて再実行してください。
        </li>
        <li style={{ marginBottom: 4 }}>
          失敗が続く場合は店舗一覧画面で詳細を確認し、開発チームへ報告してください。
        </li>
      </ul>
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

export async function buildResearchJobFailedEmail(
  input: ResearchJobFailedInput,
): Promise<EmailMessage> {
  const subject = `エリア調査ジョブが失敗しました (失敗 ${input.job.failed_count} 件)`;
  const html = await renderEmail(<ResearchJobFailedBody {...input} />);
  const text = [
    `${input.profile.display_name} さん`,
    "",
    "起動された調査ジョブが失敗のステータスで終了しました。",
    `対象 ${input.job.target_count} 件 / 成功 ${input.job.completed_count} 件 / 失敗 ${input.job.failed_count} 件`,
    "",
    "失敗の概要:",
    input.errorSummary,
    "",
    "再実行のご案内:",
    "- 一時的なネットワークエラーや外部 API のレート制限が原因の場合があります。",
    "- 失敗が続く場合は店舗一覧画面で詳細を確認し、開発チームへ報告してください。",
    "",
    `店舗一覧: ${input.appBaseUrl}/stores`,
  ].join("\n");
  return {
    to: input.profile.email,
    subject,
    html,
    text,
  };
}
