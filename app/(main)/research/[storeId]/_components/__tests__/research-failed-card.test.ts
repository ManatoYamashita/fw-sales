/**
 * `research-failed-card.tsx` の `errorMessage` 純関数の単体検証。
 *
 * observability bug 修正(実機 smoke test で発見)の一環: `deriveErrorKind` が
 * `"retryable_exhausted:api_error:503"` のように prefix + sanitized kind の形を
 * 返すようになったため、UI 側の判定を完全一致から前方一致(includes)に変更した。
 *
 * feat/ai-research-pre-smoke-hardening(MAJOR12)で、生の`error_message`を
 * UIへ直接表示する経路を廃止し、`error_kind`のallowlist mappingのみで表示文言を
 * 決定するよう変更した。`error_message`はどんな値であってもUIの出力には現れない。
 */

import { describe, it, expect } from "vitest";
import { errorMessage } from "../research-failed-card";

describe("errorMessage (research-failed-card)", () => {
  it("error_kindが'retryable_exhausted'完全一致なら再試行済みメッセージになる", () => {
    expect(
      errorMessage({ error_kind: "retryable_exhausted", error_message: "x" }),
    ).toBe("AI 調査が一時的なエラーで失敗しました(再試行済み)。再度お試しください。");
  });

  it("error_kindが'retryable_exhausted:api_error:503'のような前方一致でも再試行済みメッセージになる(prefix対応の回帰テスト)", () => {
    expect(
      errorMessage({
        error_kind: "retryable_exhausted:api_error:503",
        error_message: "Gemini呼出が一時的に失敗しました(api_error:503)。1回だけ再試行します。",
      }),
    ).toBe("AI 調査が一時的なエラーで失敗しました(再試行済み)。再度お試しください。");
  });

  it("fatal:api_error:404の場合は生のerror_messageを一切表示せず、allowlistの汎用API文言になる(feat/ai-research-pre-smoke-hardening、MAJOR12)", () => {
    const result = errorMessage({
      error_kind: "fatal:api_error:404",
      error_message: "Gemini呼出が失敗しました(api_error:404、request-id: abc123、内部スタックトレース等)",
    });
    expect(result).toBe("AI 調査中にエラーが発生しました。再度お試しください。");
    expect(result).not.toContain("request-id");
  });

  it("workflow_start_failedは専用メッセージになる", () => {
    expect(
      errorMessage({ error_kind: "workflow_start_failed", error_message: "raw internal error" }),
    ).toBe("調査の開始に失敗しました。しばらくしてから再度お試しください。");
  });

  it("stuck_run_timeoutは専用メッセージになる", () => {
    expect(errorMessage({ error_kind: "stuck_run_timeout", error_message: null })).toBe(
      "処理時間が想定を超えたため中断しました。再度お試しください。",
    );
  });

  it("fatal:missing_api_key/auth_errorは認証設定エラーの専用メッセージになる", () => {
    expect(
      errorMessage({ error_kind: "fatal:missing_api_key", error_message: "raw" }),
    ).toBe("AI 調査の認証設定に問題があります。管理者にご確認ください。");
    expect(errorMessage({ error_kind: "fatal:auth_error", error_message: "raw" })).toBe(
      "AI 調査の認証設定に問題があります。管理者にご確認ください。",
    );
  });

  it("fatal:max_tokensは専用メッセージになる", () => {
    expect(errorMessage({ error_kind: "fatal:max_tokens", error_message: "raw" })).toBe(
      "AI の応答が長くなりすぎたため調査を完了できませんでした。再度お試しください。",
    );
  });

  it("fatal:stage2_invalid_output/final_result_invalidは専用メッセージになる(BLOCKER1)", () => {
    expect(
      errorMessage({ error_kind: "fatal:stage2_invalid_output", error_message: "raw" }),
    ).toBe("AI 調査結果の検証に失敗しました。再度お試しください。");
    expect(
      errorMessage({ error_kind: "fatal:final_result_invalid", error_message: "raw" }),
    ).toBe("AI 調査結果の検証に失敗しました。再度お試しください。");
  });

  it("未知のerror_kind(unknown/fatal単体/null等)は生のerror_messageを表示せず汎用メッセージにフォールバックする", () => {
    expect(errorMessage({ error_kind: "fatal", error_message: "生のDBエラー内容" })).toBe(
      "AI 調査に失敗しました。再度お試しください。",
    );
    expect(errorMessage({ error_kind: "unknown", error_message: "生のエラー内容" })).toBe(
      "AI 調査に失敗しました。再度お試しください。",
    );
    expect(errorMessage({ error_kind: null, error_message: "生のエラー内容" })).toBe(
      "AI 調査に失敗しました。再度お試しください。",
    );
  });
});
