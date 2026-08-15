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
export function errorMessage(run: Pick<StoreResearchRun, "error_kind" | "error_message">): string {
  const kind = run.error_kind ?? "";

  // 1) Server Action 由来の kind は完全一致で先に判定する。
  //    順序が重要: `stuck_run_timeout` は後段の `includes("timeout")` に誤って
  //    吸い込まれるため、必ずここで確定させること。
  if (kind === "workflow_start_failed") {
    return "調査の開始に失敗しました。しばらくしてから再度お試しください。";
  }
  if (kind === "stuck_run_timeout") {
    return "処理時間が想定を超えたため中断しました。再度お試しください。";
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
}: {
  run: StoreResearchRun;
  onRetry: () => void;
  retrying: boolean;
}) {
  // hydration 後に解決するため、未解決(`loaded === false`)の間は表示しない
  // (既存の `settings/_components/data-actions.tsx` と同じガード)。
  const { isAdmin, loaded } = useIsAdmin();

  return (
    <Card>
      <Card.Header>
        <Card.Title>AI店舗調査</Card.Title>
      </Card.Header>
      <Card.Body className="space-y-3">
        <div className="flex items-start gap-2 text-sm text-destructive">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <div>
            <p className="font-medium">調査に失敗しました</p>
            <p className="text-muted-foreground mt-0.5">{errorMessage(run)}</p>
            {loaded && isAdmin && (
              <p className="text-xs text-muted-foreground/80 font-mono mt-1.5 break-all">
                {adminDiagnostic(run)}
              </p>
            )}
          </div>
        </div>
        <div className="flex justify-center py-1">
          <Button type="button" variant="primary" onClick={onRetry} disabled={retrying}>
            <RotateCcw className="h-3.5 w-3.5" />
            {retrying ? "開始中…" : "再調査する"}
          </Button>
        </div>
      </Card.Body>
    </Card>
  );
}
