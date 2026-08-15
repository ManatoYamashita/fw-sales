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

import { describe, it, expect, vi } from "vitest";

// `research-failed-card.tsx` は admin 限定の診断表示に `useIsAdmin` を使う。本テストが
// 対象とするのは純関数(`errorMessage` / `adminDiagnostic`)のみだが、provider の
// import 連鎖が Server Action → repositories → DB 接続 (`DATABASE_URL`) を要求するため、
// 軽量モックへ差し替えて DB 接続を避ける(`workflows/__tests__/store-research.test.ts`
// と同じ方針)。
vi.mock("@/components/layout/current-user-provider", () => ({
  useIsAdmin: () => ({ isAdmin: false, loaded: true }),
}));

const { errorMessage, adminDiagnostic } = await import("../research-failed-card");

describe("errorMessage (research-failed-card)", () => {
  it("error_kindが'retryable_exhausted'完全一致(種別トークン無し)なら汎用の再試行済みメッセージになる", () => {
    expect(
      errorMessage({ error_kind: "retryable_exhausted", error_message: "x" }),
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

  it.each(["json_parse", "schema", "coverage", "identity"])(
    "fatal:stage2_invalid_output:%s(runtime hardening、2026-08-07で追加した4分類)も同じ専用メッセージになる(UI文言は変更不要)",
    (kind) => {
      expect(
        errorMessage({ error_kind: `fatal:stage2_invalid_output:${kind}`, error_message: "raw" }),
      ).toBe("AI 調査結果の検証に失敗しました。再度お試しください。");
    },
  );

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

  /**
   * runtime reliability hardening (F1/F2)。
   *
   * Workflow SDK が retry 使い切りを `FatalError` でラップするため、旧実装では
   * quota 系も timeout も network もすべて `fatal:*` に潰れて generic 文言
   * 「AI 調査に失敗しました。再度お試しください。」に落ちていた(2026-08 の billing
   * 障害でユーザーが見たのがこれ)。`deriveErrorKind` の修正で
   * `retryable_exhausted:<token>` が復活したので、種別ごとに「次に何をすべきか」が
   * 分かる文言へ分解する。
   */
  describe("retry消尽したエラーの種別別メッセージ", () => {
    it("rate_limitは混雑/利用上限を伝え、繰り返す場合の管理者確認まで案内する", () => {
      const result = errorMessage({
        error_kind: "retryable_exhausted:rate_limit",
        error_message: "raw",
      });
      expect(result).toBe(
        "AI サービスが混雑しているか、利用上限に達しています。時間をおいて再調査してください。繰り返し失敗する場合は管理者にご確認ください。",
      );
    });

    it("api_error:503は一時的な利用不可として案内する", () => {
      expect(
        errorMessage({ error_kind: "retryable_exhausted:api_error:503", error_message: "raw" }),
      ).toBe("AI サービスが一時的に利用できません。少し時間をおいて再調査してください。");
    });

    it("timeoutは時間内未完了として案内する", () => {
      expect(
        errorMessage({ error_kind: "retryable_exhausted:timeout", error_message: "raw" }),
      ).toBe("AI 調査が時間内に完了しませんでした。再調査してください。");
    });

    it("network_errorは通信エラーとして案内する", () => {
      expect(
        errorMessage({ error_kind: "retryable_exhausted:network_error", error_message: "raw" }),
      ).toBe("通信エラーで調査を完了できませんでした。再調査してください。");
    });

    // F1 修正前に本番で記録されていた値。修正後は出なくなるが、既存 run の履歴表示で
    // 遭遇しうるため generic に落とさず同じ文言を出す(後方互換)。
    it("旧形式のfatal:rate_limitも同じ文言になる(既存run履歴の後方互換)", () => {
      expect(errorMessage({ error_kind: "fatal:rate_limit", error_message: "raw" })).toBe(
        "AI サービスが混雑しているか、利用上限に達しています。時間をおいて再調査してください。繰り返し失敗する場合は管理者にご確認ください。",
      );
    });

    // `stuck_run_timeout` は `includes("timeout")` に誤って捕まりうる。完全一致判定を
    // 先に置くという順序の不変条件を固定する。
    it("stuck_run_timeoutはtimeout分岐に吸い込まれず専用メッセージのままである", () => {
      expect(errorMessage({ error_kind: "stuck_run_timeout", error_message: null })).toBe(
        "処理時間が想定を超えたため中断しました。再度お試しください。",
      );
    });

    it("認証エラーはretryable判定より先に評価され専用メッセージのままである", () => {
      expect(errorMessage({ error_kind: "fatal:auth_error", error_message: "raw" })).toBe(
        "AI 調査の認証設定に問題があります。管理者にご確認ください。",
      );
    });

    it("どの種別でも生のerror_messageを表示しない", () => {
      const RAW = "Step \"stage1Step\" failed after 1 retry: key=AIzaSyFAKE requestId=abc-123";
      for (const kind of [
        "retryable_exhausted:rate_limit",
        "retryable_exhausted:api_error:503",
        "retryable_exhausted:timeout",
        "retryable_exhausted:network_error",
      ]) {
        const result = errorMessage({ error_kind: kind, error_message: RAW });
        expect(result).not.toContain("AIzaSyFAKE");
        expect(result).not.toContain("abc-123");
        expect(result).not.toContain("stage1Step");
      }
    });
  });
});

/**
 * admin 限定の診断表示 (runtime reliability hardening)。
 *
 * 出してよいのは **sanitized な `error_kind` と `stage` だけ**。`error_message` は
 * raw が入りうるため admin にも出さない(MAJOR12 の方針を維持する)。
 */
describe("adminDiagnostic (research-failed-card)", () => {
  it("error_kindとstageのみを含む", () => {
    expect(adminDiagnostic({ error_kind: "retryable_exhausted:rate_limit", stage: "discovering" })).toBe(
      "診断コード: retryable_exhausted:rate_limit / stage: discovering",
    );
  });

  it("error_kind/stageがnullでも壊れない", () => {
    expect(adminDiagnostic({ error_kind: null, stage: null })).toBe(
      "診断コード: (なし) / stage: (なし)",
    );
  });
});
