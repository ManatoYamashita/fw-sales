"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { getDeepResearchJobStatusAction } from "@/lib/actions/deep-research-actions";
import { isPendingStatus, type JobStatus } from "@/types/deep-research";

/**
 * 進行中ジョブ詳細ページ (`/research/jobs/[jobId]`) の自動リフレッシュ補助。
 *
 * page.tsx は進行中ジョブを開いた瞬間に `after(kickBackgroundPollTick)` で
 * 背景ポーリング tick を 1 発火するが、`after()` はレスポンス送信後に走るため
 * その結果は「今の画面」には反映されない。本コンポーネントは status を軽量に
 * 監視し、背景 tick が DB を進めた瞬間だけ `router.refresh()` を呼んで画面を最新化する。
 *
 * 設計上の注意:
 * - `router.refresh()` は Server Component を再実行し `after()` を再発火させる。
 *   固定間隔で refresh すると `structuring` の Stage 2 (Gemini 構造化) が並行二重
 *   起動しうるため、ここでは「status が変化した瞬間だけ refresh」に限定する。
 * - `researching` かつ taskId 有りは `GeminiLiveStatusCard`、`structuring` は
 *   `StructuringLiveCard` がそれぞれ能動ポーリング + refresh を担当するため対象外
 *   (二重 watch を避ける)。本コンポーネントはその補集合 (queued /
 *   researching かつ taskId 未設定) を読み取り専用で監視する。
 * - status 監視は読み取り専用 action (`getDeepResearchJobStatusAction`) を使い、
 *   poll tick を発火しない。
 */

const POLL_INTERVAL_MS = 10_000;

interface JobAutoRefreshProps {
  jobId: string;
  status: JobStatus;
  taskId: string | null;
}

export function JobAutoRefresh({ jobId, status, taskId }: JobAutoRefreshProps) {
  const router = useRouter();

  // researching(+taskId) は GeminiLiveStatusCard、structuring は
  // StructuringLiveCard が能動ポーリングで担当するため、ここでは除外する
  // (二重監視・二重 tick 発火を避ける)。本コンポーネントは queued と
  // researching(taskId 未設定) のみを読み取り専用で監視する。
  const handledByLiveCard =
    (status === "researching" && !!taskId) || status === "structuring";
  const shouldWatch = isPendingStatus(status) && !handledByLiveCard;

  useEffect(() => {
    if (!shouldWatch) return;

    let cancelled = false;
    const id = setInterval(async () => {
      const result = await getDeepResearchJobStatusAction(jobId);
      if (cancelled) return;
      if (result.ok && result.data.status !== status) {
        // 背景 tick がジョブを進めた。画面を最新化する。
        // 新 status は親 Server Component から props 経由で渡り、この effect は
        // deps 変化で再評価され、終了状態 (done/failed) なら監視を停止する。
        router.refresh();
      }
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [shouldWatch, jobId, status, router]);

  return null;
}
