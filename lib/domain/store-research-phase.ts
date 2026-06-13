/**
 * 店舗の調査フェーズ導出 (store-flow-guidance / Issue #122)
 *
 * 店舗が「追加 → DeepResearch → 架電生成」の標準フローのどこにいるかを、現行スキーマ
 * (`basic_info` の充足 + `ai_analysis_result` の有無) から純粋に導出する。営業ステージ
 * (`stage`) とは独立した「データ充足の進み具合」の軸。
 *
 * 状態は 3 つ (#121 後の実態に整合):
 * - `untouched` 未調査: 基本情報が乏しい。まず基本情報を補う。
 * - `ready`     調査可: コア基本情報が揃い、DeepResearch に足る。
 * - `generated` 生成済み: 営業資産 (`ai_analysis_result`) が存在する。
 *
 * 「調査取込済 (貼付済・未生成)」の中間状態は持たない。#121 でワークベンチが単線化され
 * 貼付テキストが永続化されない (生成時に瞬間的に渡すのみ) ため、その状態を検出する信号が
 * 存在しないことによる (4→3 状態への意図的縮退)。
 *
 * 依存方向: `lib/domain` は `lib/ai` を import しない。型のみ `types/*` に依存する純関数。
 *
 * 関連: .kiro/specs/store-flow-guidance/{requirements,design,tasks}.md
 */

import type { BasicInfo, BasicInfoField } from "@/types/basic-info";
import type { Store } from "@/types/store";

export type ResearchPhase = "untouched" | "ready" | "generated";

/**
 * 「調査可」判定に用いるコア基本情報キー。
 *
 * エリア検索の公開地図情報 (`primary="places"`) で充填されうる項目のうち、店舗名を除いた
 * 実質的な所在・属性情報。`BASIC_INFO_ITEMS` (lib/domain/basic-info-items.ts) の
 * primary="places" 7 項目から `store_name` を除いた 6 項目。
 */
export const CORE_BASIC_INFO_KEYS = [
  "address",
  "cuisine_genre",
  "business_hours_holidays",
  "official_site",
  "location_feature",
  "nearest_station",
] as const;

/**
 * 「調査可」へ昇格するために必要なコア項目の充足数。
 *
 * エリア検索の自動充填 (`placeResultToBasicInfo`) が埋めるコアは実測で
 * `address` + `cuisine_genre` の 2 項目 (`store_name` はコア外)。標準フロー
 * 「エリア検索で追加 → 調査」を成立させるため閾値は **2**。これにより
 * エリア検索由来の店舗は「調査可」、店名のみの手動店舗は「未調査」になる。
 */
export const READY_CORE_THRESHOLD = 2;

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

/** コア基本情報キーのうち充填済みの数 (0..CORE_BASIC_INFO_KEYS.length)。 */
export function filledCoreCount(basicInfo: BasicInfo): number {
  return CORE_BASIC_INFO_KEYS.reduce(
    (count, key) => count + (isBasicInfoFieldFilled(basicInfo[key]) ? 1 : 0),
    0,
  );
}

/**
 * 店舗の調査フェーズを導出する純関数。
 *
 * 優先順: `generated` > `ready` > `untouched`。`ai_analysis_result` が存在すれば必ず
 * `generated`。登録経路 (エリア検索 / 手動) に依らず同じ信号で判定する。
 */
export function getStoreResearchPhase(
  store: Pick<Store, "ai_analysis_result" | "basic_info">,
): ResearchPhase {
  if (store.ai_analysis_result != null) return "generated";
  if (filledCoreCount(store.basic_info) >= READY_CORE_THRESHOLD) return "ready";
  return "untouched";
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
  { badgeLabel: string; badgeTone: "warning" | "info" | "success"; cta: PhaseCta }
> = {
  untouched: {
    // 営業ステージ (types/stage.ts) の値 "未調査" との文字列衝突を避け、
    // かつ実態 (コア基本情報が閾値未満 = 調査の前に情報補完が必要) を表すラベル。
    badgeLabel: "基本情報待ち",
    badgeTone: "warning",
    cta: {
      label: "基本情報を入力",
      href: (id) => `/stores/${id}?tab=basic`,
      variant: "secondary",
      hint: "エリア検索や手動入力で基本情報を補うと、DeepResearch の精度が上がります",
    },
  },
  ready: {
    badgeLabel: "調査可",
    badgeTone: "info",
    cta: {
      label: "調査して生成",
      href: (id) => `/research/${id}`,
      variant: "primary",
    },
  },
  generated: {
    badgeLabel: "生成済み",
    badgeTone: "success",
    cta: {
      label: "営業資産を再生成",
      href: (id) => `/research/${id}`,
      variant: "secondary",
    },
  },
};
