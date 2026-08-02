/**
 * `research-failed-card.tsx` の `errorMessage` 純関数の単体検証。
 *
 * observability bug 修正(実機 smoke test で発見)の一環: `deriveErrorKind` が
 * `"retryable_exhausted:api_error:503"` のように prefix + sanitized kind の形を
 * 返すようになったため、UI 側の判定を完全一致から前方一致に変更した。この回帰を
 * 防ぐための最小テスト。
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

  it("fatal:api_error:404の場合はerror_message(HTTP status付き)をそのまま安全に表示する", () => {
    expect(
      errorMessage({
        error_kind: "fatal:api_error:404",
        error_message: "Gemini呼出が失敗しました(api_error:404)",
      }),
    ).toBe("Gemini呼出が失敗しました(api_error:404)");
  });

  it("error_messageが無ければ汎用メッセージにフォールバックする", () => {
    expect(errorMessage({ error_kind: "fatal", error_message: null })).toBe(
      "AI 調査に失敗しました。再度お試しください。",
    );
  });
});
