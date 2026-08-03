"use client";

/** 調査失敗カード(Plan v3.2 §5.8)。エラー種別で文言を出し分ける。自動リトライはしない。 */

import { AlertTriangle, RotateCcw } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { StoreResearchRun } from "@/types/research-run";

/**
 * `run.error_kind` は `workflows/store-research.ts:deriveErrorKind` が
 * `"retryable_exhausted"` / `"fatal:auth_error"` のように prefix + sanitized kind の
 * 形で返すため、部分一致(`includes`)で判定する。`run.error_message`(生のDB/Workflow
 * エラーメッセージ)はUIへ**直接表示しない**(feat/ai-research-pre-smoke-hardening、
 * MAJOR12)。表示文言は`error_kind`のallowlist mappingのみで決定し、未知のkindは
 * 一律genericメッセージにする。`error_message`はログ・内部監査用にDBへ保持したまま
 * でよいが、UIの根拠には使わない。
 */
export function errorMessage(run: Pick<StoreResearchRun, "error_kind" | "error_message">): string {
  const kind = run.error_kind ?? "";

  if (kind.includes("retryable_exhausted")) {
    return "AI 調査が一時的なエラーで失敗しました(再試行済み)。再度お試しください。";
  }
  if (kind === "workflow_start_failed") {
    return "調査の開始に失敗しました。しばらくしてから再度お試しください。";
  }
  if (kind === "stuck_run_timeout") {
    return "処理時間が想定を超えたため中断しました。再度お試しください。";
  }
  if (kind.includes("auth_error") || kind.includes("missing_api_key")) {
    return "AI 調査の認証設定に問題があります。管理者にご確認ください。";
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

export function ResearchFailedCard({
  run,
  onRetry,
  retrying,
}: {
  run: StoreResearchRun;
  onRetry: () => void;
  retrying: boolean;
}) {
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
