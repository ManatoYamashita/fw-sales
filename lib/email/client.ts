/**
 * Resend ベースのメール送信クライアント (auth-and-notifications spec, Issue #16)
 *
 * 全送信メールの単一窓口。`RESEND_API_KEY` 未設定時は no-op + warn ログで
 * 業務処理を阻害せず、`@local.invalid` 宛は placeholder 保護として送信しない。
 * 送信失敗時も throw せず `{ kind: "failed" }` を返し、呼び出し側 (Cron / Job
 * フック) で error ログを残しつつ業務処理を継続させる (Req 4.1, 4.2, 4.3, 8.3)。
 *
 * 件名は `buildSubject(raw)` でツール識別プレフィックス `[fw-sales] ` を強制
 * 付与する (Req 4.4)。
 *
 * 関連: design.md §「lib/email/client.ts」, requirements.md §4.1, §4.2, §4.3, §4.4, §8.3
 */

import "server-only";
import { Resend } from "resend";

export interface EmailMessage {
  readonly to: string;
  readonly subject: string;
  readonly html: string;
  readonly text?: string;
}

export type EmailSendResult =
  | { readonly kind: "ok"; readonly id: string }
  | { readonly kind: "noop"; readonly reason: "missing_api_key" | "placeholder_recipient" }
  | { readonly kind: "failed"; readonly error: string };

const SUBJECT_PREFIX = "[fw-sales] ";
const PLACEHOLDER_DOMAIN = "@local.invalid";

let _resendInstance: Resend | null = null;
let _missingKeyWarned = false;
let _missingFromWarned = false;

function readEnv(): { apiKey: string; from: string } | null {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;
  if (!apiKey) {
    if (!_missingKeyWarned) {
      console.warn(
        "[email] RESEND_API_KEY is not set. All email sends will be no-op until configured.",
      );
      _missingKeyWarned = true;
    }
    return null;
  }
  if (!from) {
    if (!_missingFromWarned) {
      console.warn(
        "[email] RESEND_FROM_EMAIL is not set. All email sends will be no-op until configured.",
      );
      _missingFromWarned = true;
    }
    return null;
  }
  return { apiKey, from };
}

function getResend(apiKey: string): Resend {
  if (!_resendInstance) {
    _resendInstance = new Resend(apiKey);
  }
  return _resendInstance;
}

function buildSubject(raw: string): string {
  if (raw.startsWith(SUBJECT_PREFIX)) return raw;
  return `${SUBJECT_PREFIX}${raw}`;
}

async function send(message: EmailMessage): Promise<EmailSendResult> {
  if (message.to.toLowerCase().endsWith(PLACEHOLDER_DOMAIN)) {
    // placeholder 宛は誤配信防止のため送信しない (Req 3.5 連携)
    return { kind: "noop", reason: "placeholder_recipient" };
  }

  const env = readEnv();
  if (!env) {
    return { kind: "noop", reason: "missing_api_key" };
  }

  const resend = getResend(env.apiKey);
  try {
    const { data, error } = await resend.emails.send({
      from: env.from,
      to: message.to,
      subject: buildSubject(message.subject),
      html: message.html,
      ...(message.text ? { text: message.text } : {}),
    });
    if (error || !data) {
      const errorMessage = error?.message ?? "unknown error";
      console.error("[email] Resend send failed:", errorMessage);
      return { kind: "failed", error: errorMessage };
    }
    return { kind: "ok", id: data.id };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error("[email] Resend send threw:", errorMessage);
    return { kind: "failed", error: errorMessage };
  }
}

export const emailClient = {
  send,
  buildSubject,
} as const;
