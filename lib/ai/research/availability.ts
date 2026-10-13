/**
 * AI 店舗調査を「いまこの環境で」実行できるかの事前判定 (Issue #324)。
 *
 * 判定はアプリの run (`store_research_runs`) を作る前に行う。設定が足りない環境で
 * run を作ると、Workflow の中で同じ理由で必ず失敗し、利用者は数分待たされたうえで
 * 「再調査」を押して同じ失敗を繰り返すことになる。
 *
 * 返す文言は利用者向けの固定文だけで、環境変数の値・キー名は含めない
 * (`lib/env.ts` の方針と同じ)。
 *
 * 純関数。`env` を引数で受け取るので、テストは `process.env` を書き換えずに済む。
 */

export type ResearchUnavailableReason =
  /** Vercel の外 (ローカルの検証環境など) で、AI の API キーを渡していない。 */
  | "local_disabled"
  /** デプロイ環境で、AI の API キーが設定されていない。 */
  | "missing_api_key";

export type ResearchAvailability =
  | { available: true }
  | { available: false; reason: ResearchUnavailableReason; message: string };

export const RESEARCH_UNAVAILABLE_MESSAGES: Record<ResearchUnavailableReason, string> = {
  local_disabled:
    "この検証環境ではAI調査を実行できません。店舗情報の入力や画面の確認はできます。",
  missing_api_key:
    "AI調査を利用するための設定が完了していません。管理者に設定を依頼してください。",
};

function isBlank(value: string | undefined): boolean {
  return value === undefined || value.trim() === "";
}

export function getResearchAvailability(
  env: Record<string, string | undefined> = process.env,
): ResearchAvailability {
  if (!isBlank(env.GEMINI_API_KEY)) return { available: true };
  // Vercel は実行中の Function に `VERCEL=1` を渡す。それ以外 (ローカルの dev / 検証用の
  // 起動) では、外部 API を意図して止めていることが多いので、管理者への依頼ではなく
  // 「この環境では使えない」と伝える。
  const reason: ResearchUnavailableReason =
    env.VERCEL === "1" ? "missing_api_key" : "local_disabled";
  return { available: false, reason, message: RESEARCH_UNAVAILABLE_MESSAGES[reason] };
}
