/**
 * 店舗の営業資産フェーズ導出 (store-flow-guidance / Issue #122 → #300 で再編)
 *
 * 店舗詳細のバッジと単一 CTA が使う「営業資産があるか」の軸。営業ステージ (`stage`) とも、
 * AI 店舗調査の run 状態とも独立している。
 *
 * 状態は 2 つ:
 * - `pending`   未生成: 営業資産 (`ai_analysis_result`) がまだ無い。
 * - `generated` 生成済み: 営業資産が存在する。
 *
 * ## #300 で 3 状態から 2 状態へ縮退した理由
 *
 * #122 当時は「基本情報待ち (untouched) / 調査可 (ready)」を Places 由来のコア項目数で
 * 分けていた。AI 店舗調査は店舗名だけで開始でき、調査そのものが基本情報を埋めるため、
 * その区別は推奨手順 (登録 → AI 調査 → レビュー → 生成) の上で意味を失った。
 * 「基本情報を入力」へ誘導する CTA は手順と矛盾していたので撤去した。
 *
 * 調査の進み具合 (未調査 / レビュー待ち / 調査済み) は本モジュールでは扱わない。
 * 店舗単位の調査状態は `lib/domain/store-research-status.ts` (#299) が単一の真実で、
 * `/research/[storeId]` の手順表示は `lib/domain/research-flow.ts` が持つ。店舗詳細は
 * 静的シェルを崩さないよう、run を Suspense の内側でだけ読む
 * (`app/(main)/stores/[id]/_components/store-research-review-notice.tsx`)。
 *
 * 依存方向: `lib/domain` は `lib/ai` を import しない。型のみ `types/*` に依存する純関数。
 */

import type { BasicInfoField } from "@/types/basic-info";
import type { Store } from "@/types/store";

export type ResearchPhase = "pending" | "generated";

/**
 * 基本情報 1 項目が充填済みかを判定する。
 *
 * `filled_by` が付与され、かつ `value` が非空白であれば充填済み。未充足項目は枠としては
 * 存在するが `filled_by === null`。
 */
export function isBasicInfoFieldFilled(
  field: BasicInfoField | undefined,
): boolean {
  if (!field || field.filled_by === null) return false;
  return field.value !== null && field.value.trim() !== "";
}

/** 店舗の営業資産フェーズを導出する純関数。 */
export function getStoreResearchPhase(
  store: Pick<Store, "ai_analysis_result">,
): ResearchPhase {
  return store.ai_analysis_result != null ? "generated" : "pending";
}

/** 営業資産の生成・更新を行う唯一の場所 (`/research/[storeId]` の生成セクション) への href。 */
export function salesAssetsHref(storeId: string): string {
  return `/research/${storeId}#sales-assets`;
}

/** 状態別の次アクション CTA 定義。 */
export interface PhaseCta {
  label: string;
  href: (storeId: string) => string;
  variant: "primary" | "secondary";
  /** CTA 下に添える補足。なければ表示しない。 */
  hint?: string;
}

/** 状態別の表示メタ (バッジ + 単一 CTA)。 */
export const RESEARCH_PHASE_META: Record<
  ResearchPhase,
  { badgeLabel: string; badgeTone: "secondary" | "success"; cta: PhaseCta }
> = {
  pending: {
    // 「調査」ではなく「営業資産」の状態であることをラベル自体に書く (#300)。
    badgeLabel: "営業資産 未生成",
    badgeTone: "secondary",
    cta: {
      label: "AI調査から始める",
      href: (id) => `/research/${id}`,
      variant: "primary",
      hint: "店舗名だけで調査できます。AI調査 → レビュー → 営業資産の生成の順に進みます",
    },
  },
  generated: {
    badgeLabel: "営業資産 生成済み",
    badgeTone: "success",
    cta: {
      label: "営業資産を更新",
      href: salesAssetsHref,
      variant: "secondary",
    },
  },
};
