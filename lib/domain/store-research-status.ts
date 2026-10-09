/**
 * 店舗の調査状態 (Issue #299)。
 *
 * サイドバーの「調査」バッジ・`/research` のタブ・`/stores` の調査段階列・店舗詳細は、
 * すべてこのモジュールの純関数から調査状態を導く。#299 以前はバッジが
 * `stage === "未調査"` を、`/research` が「未レビューの succeeded run の有無」を
 * それぞれ独自に数えており、同じ店舗が画面ごとに「調査済み」「要確認」と食い違っていた。
 *
 * ## 判定の優先順位
 * 1. 未レビューの AI 調査結果 (succeeded かつ review_completed_at IS NULL の run) がある
 *    → 「レビュー待ち」。手動で変えられる `stage` より優先する。レビューが済むまで
 *    調査結果は基本情報へ反映されていないため、`stage` が何であれ人の作業が残っている。
 * 2. それ以外は `stage` (未調査 / 調査済み / 架電済み) をそのまま使う。
 *
 * 「レビュー待ち」は AI 調査のレビューにだけ使う語。チャネル値の「要確認」
 * (DM / テレアポのどちらで当たるか未判断) とは別物なので、同じ語を使わない。
 *
 * 依存方向: `types/*` のみに依存する純関数。DB I/O は呼び出し側
 * (`lib/queries/research.ts`) が行い、未レビュー店舗の id 集合として渡す。
 */

import { STAGES, type StageId } from "@/types/stage";

export const RESEARCH_REVIEW_PENDING = "レビュー待ち" as const;

export type StoreResearchStatus = typeof RESEARCH_REVIEW_PENDING | StageId;

/**
 * 表示・絞り込み・並べ替えに使う順序。作業の進み具合の順に並べる
 * (未調査 → レビュー待ち → 調査済み → 架電済み)。
 */
export const STORE_RESEARCH_STATUSES: readonly StoreResearchStatus[] = [
  "未調査",
  RESEARCH_REVIEW_PENDING,
  ...STAGES.map((s) => s.id).filter((id) => id !== "未調査"),
];

export function isStoreResearchStatus(value: string): value is StoreResearchStatus {
  return (STORE_RESEARCH_STATUSES as readonly string[]).includes(value);
}

/** 店舗 1 件の調査状態を導く。 */
export function getStoreResearchStatus(
  stage: StageId,
  needsReview: boolean,
): StoreResearchStatus {
  return needsReview ? RESEARCH_REVIEW_PENDING : stage;
}

/** {@link STORE_RESEARCH_STATUSES} の順序で比較する。未知の値は末尾へ寄せる。 */
export function compareStoreResearchStatus(
  a: StoreResearchStatus,
  b: StoreResearchStatus,
): number {
  const rank = (s: StoreResearchStatus) => {
    const i = STORE_RESEARCH_STATUSES.indexOf(s);
    return i === -1 ? Number.MAX_SAFE_INTEGER : i;
  };
  return rank(a) - rank(b);
}
