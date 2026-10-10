"use client";

/** 調査失敗カード(Plan v3.2 §5.8)。エラー種別で文言を出し分ける。自動リトライはしない。 */

import { AlertTriangle, RotateCcw } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useIsAdmin } from "@/components/layout/current-user-provider";
import type { StoreResearchRun } from "@/types/research-run";

/**
 * `run.error_kind` は `workflows/store-research.ts:deriveErrorKind` が
 * `"retryable_exhausted"` / `"fatal:auth_error"` のように prefix + sanitized kind の
 * 形で返すため、部分一致(`includes`)で判定する。表示文言は`error_kind`のallowlist
 * mappingのみで決定し、未知のkindは一律genericメッセージにする。
 *
 * 現行runの`error_message`は`workflows/store-research.ts:buildFailureRecord`および
 * `lib/actions/research-run-actions.ts`で固定sanitized文言のみを保存する。ただし、この
 * hardening以前に作成された過去runにはrawなDB/Workflowエラーメッセージが残っている
 * 可能性がある。後方互換とdefense in depthのため、`error_message`は一般ユーザーにも
 * adminにも**直接表示せず**、UI文言の根拠にも使わない
 * (feat/ai-research-pre-smoke-hardening、MAJOR12)。
 */
export function errorMessage(
  run: Pick<StoreResearchRun, "error_kind" | "error_message"> &
    Partial<Pick<StoreResearchRun, "stage">>,
): string {
  const kind = run.error_kind ?? "";

  // 1) Server Action 由来の kind は完全一致で先に判定する。
  //    順序が重要: `stuck_run_timeout` は後段の `includes("timeout")` に誤って
  //    吸い込まれるため、必ずここで確定させること。
  if (kind === "workflow_start_failed") {
    return "調査の開始に失敗しました。しばらくしてから再度お試しください。";
  }
  if (kind === "stuck_run_timeout") {
    // 再調査を始めるときに、期限を過ぎた run をアプリ側で打ち切ったもの。
    return "処理が上限の時間内に終わらなかったため、この調査を打ち切りました。再調査してください。";
  }
  // 実行基盤 (Workflow) が終了したのに結果が記録されなかったもの (#324、
  // `lib/ai/research/workflow-run-sync.ts`)。stage が無ければ最初の工程にも届いていない。
  if (kind === "workflow_run_failed" || kind === "workflow_run_completed_without_result") {
    return run.stage
      ? "調査の処理が途中で止まりました。時間をおいて再調査してください。繰り返し起きる場合は管理者に確認してください。"
      : "調査を開始できませんでした。時間をおいて再調査してください。繰り返し起きる場合は管理者に確認してください。";
  }
  if (kind === "workflow_run_cancelled") {
    return "調査が取り消されました。必要であれば再調査してください。";
  }

  // 2) retry しても直らない恒久的な設定不備。retryable 系トークンとは排他だが、
  //    「管理者に確認すべき」ケースを取りこぼさないよう先に評価する。
  if (kind.includes("auth_error") || kind.includes("missing_api_key")) {
    return "AI 調査の認証設定に問題があります。管理者にご確認ください。";
  }

  // 3) retry したが回復しなかった一過性エラー(runtime reliability hardening、F2)。
  //    種別ごとにユーザーが次に取るべき行動が違うため文言を分ける。
  //
  //    旧実装は `retryable_exhausted` の1分岐しか無く、しかも Workflow SDK が
  //    retry 消尽を `FatalError` でラップする仕様(`deriveErrorKind` の JSDoc 参照)
  //    により実際には `fatal:rate_limit` 等になっていたため、どれも最終行の
  //    generic 文言に落ちていた。2026-08 の billing 障害でユーザーが見たのがこれ。
  //
  //    `fatal:*` 形式も同じ文言にマップする: F1 修正前に記録された既存 run が
  //    履歴表示で参照されうるため(後方互換)。
  if (kind.includes("rate_limit")) {
    // billing / prepaid credit 枯渇と一時的な rate limit は、Gemini SDK から安全に
    // 区別できる signal が現時点で確認できていない(`extractProviderDiagnostics` の
    // JSDoc 参照)。したがって断定せず、両方に当てはまる案内にする。
    return "AI サービスが混雑しているか、利用上限に達しています。時間をおいて再調査してください。繰り返し失敗する場合は管理者にご確認ください。";
  }
  if (kind.includes("api_error:503")) {
    return "AI サービスが一時的に利用できません。少し時間をおいて再調査してください。";
  }
  if (kind.includes("network_error")) {
    return "通信エラーで調査を完了できませんでした。再調査してください。";
  }
  if (kind.includes("timeout")) {
    return "AI 調査が時間内に完了しませんでした。再調査してください。";
  }
  // 種別トークンを持たない裸の `retryable_exhausted` 用のフォールバック。
  if (kind.includes("retryable_exhausted")) {
    return "AI 調査が一時的なエラーで失敗しました(再試行済み)。再度お試しください。";
  }

  if (kind.includes("max_tokens")) {
    return "AI の応答が長くなりすぎたため調査を完了できませんでした。再度お試しください。";
  }
  if (kind.includes("stage2_invalid_output") || kind.includes("final_result_invalid")) {
    return "AI 調査結果の検証に失敗しました。再度お試しください。";
  }
  if (kind.includes("api_error")) {
    return "AI 調査中にエラーが発生しました。再度お試しください。";
  }
  return "AI 調査に失敗しました。再度お試しください。";
}

/**
 * 失敗の原因から、利用者が次に取るべき行動を返す (#324)。
 *
 * - `retry`: 再調査で直る見込みがある。再調査を主ボタンで促す
 * - `admin`: 設定の不備など、管理者が直すまで再調査しても同じ失敗になる。
 *   再調査は主ボタンにせず、設定を直した後に使う控えめなボタンにとどめる
 */
export function failureNextStep(run: Pick<StoreResearchRun, "error_kind">): "retry" | "admin" {
  const kind = run.error_kind ?? "";
  return kind.includes("auth_error") || kind.includes("missing_api_key") ? "admin" : "retry";
}

/**
 * admin にのみ表示する 1 行の診断表示(runtime reliability hardening)。
 *
 * 一般ユーザー向け文言は必ず allowlist 経由の定型文になるため、未知の `error_kind` が
 * 出たときに「何が起きたか」を画面から判断できない。障害のたびに Supabase を開かずに
 * 済むよう、admin にだけ sanitized な識別子を出す。
 *
 * **出してよいのは `error_kind` と `stage` だけ。** 現行runの`error_message`は固定
 * sanitized文言だが、hardening以前の過去runにはrawなWorkflow/DBメッセージが残っている
 * 可能性があるため、後方互換とdefense in depthとしてadminにも表示しない
 * (MAJOR12 の方針を維持)。
 */
export function adminDiagnostic(run: Pick<StoreResearchRun, "error_kind" | "stage">): string {
  return `診断コード: ${run.error_kind ?? "(なし)"} / stage: ${run.stage ?? "(なし)"}`;
}

export function ResearchFailedCard({
  run,
  onRetry,
  retrying,
  unavailableMessage,
}: {
  run: StoreResearchRun;
  onRetry: () => void;
  retrying: boolean;
  /**
   * いまの環境で AI 調査を実行できない理由 (`getResearchAvailability`)。あれば再調査の
   * ボタンを出さず、理由を示す。押しても同じ理由で失敗するため (#324)。
   */
  unavailableMessage: string | null;
}) {
  // hydration 後に解決するため、未解決(`loaded === false`)の間は表示しない
  // (既存の `settings/_components/data-actions.tsx` と同じガード)。
  const { isAdmin, loaded } = useIsAdmin();
  const nextStep = failureNextStep(run);

  return (
    <Card>
      <Card.Header>
        <Card.Title>AI店舗調査</Card.Title>
      </Card.Header>
      <Card.Body className="space-y-3">
        <div role="alert" className="flex items-start gap-2 text-sm text-destructive">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" aria-hidden />
          <div>
            <p className="font-medium">調査に失敗しました</p>
            {/* 実行できない環境では、原因別の「再調査してください」を出すと理由と食い違う。
                次の操作は実行できない理由の案内だけにする。 */}
            <p className="text-muted-foreground mt-0.5">
              {unavailableMessage ?? errorMessage(run)}
            </p>
            {loaded && isAdmin && (
              <p className="text-xs text-muted-foreground/80 font-mono mt-1.5 break-all">
                {adminDiagnostic(run)}
              </p>
            )}
          </div>
        </div>
        {unavailableMessage === null && (
          <div className="flex justify-center py-1">
            <Button
              type="button"
              variant={nextStep === "retry" ? "primary" : "outline"}
              onClick={onRetry}
              pending={retrying}
            >
              <RotateCcw className="h-3.5 w-3.5" aria-hidden />
              {retrying ? "開始中…" : nextStep === "retry" ? "再調査する" : "設定の確認後に再調査する"}
            </Button>
          </div>
        )}
      </Card.Body>
    </Card>
  );
}
