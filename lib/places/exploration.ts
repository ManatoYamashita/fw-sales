import { distanceMeters } from "@/lib/utils/geo";
import type { AreaSearchPlaceViewModel, SearchCenter } from "./types";

/**
 * 1検索条件 (Text Search 1ページ) で取得できる最大件数の目安。
 * `pageSize` のデフォルト (20) × 「さらに候補を読み込む」3ページ分。
 * これに達しても「範囲内の全店舗を取得済み」を意味しない (Google Places の
 * 検索結果集合の上限に達しただけ)。
 */
export const SEARCH_RESULT_SOFT_LIMIT = 60;

/** 登録候補がこの件数以下の場合、追加探索の案内を表示する。 */
export const FEW_ELIGIBLE_THRESHOLD = 3;

const IZAKAYA_KEYWORD_SUGGESTIONS = [
  "飲み屋",
  "酒場",
  "大衆酒場",
  "焼き鳥",
  "海鮮居酒屋",
  "和食居酒屋",
  "ダイニングバー",
  "バー",
];

const GENERIC_KEYWORD_SUGGESTIONS = ["飲食店", "レストラン", "カフェ", "バー", "居酒屋"];

/**
 * 現在のキーワードに応じて、追加探索向けの別キーワード候補を返す。
 * 現在のキーワードと同じ候補は除外する。
 *
 * 「居酒屋」系キーワードの場合は近縁ジャンルを、それ以外は汎用候補を返す。
 */
export function suggestExplorationKeywords(keyword: string): string[] {
  const trimmed = keyword.trim();
  const base = trimmed.includes("居酒屋")
    ? IZAKAYA_KEYWORD_SUGGESTIONS
    : GENERIC_KEYWORD_SUGGESTIONS;
  return base.filter((candidate) => candidate !== trimmed);
}

/**
 * 中心地点(駅名・地名)に応じた周辺地点候補のテーブル。
 * 将来的に他エリアを追加する場合はここにキーを追加する。
 */
const CENTER_SUGGESTIONS_TABLE: ReadonlyArray<{
  matches: (centerQuery: string) => boolean;
  suggestions: readonly string[];
}> = [
  {
    matches: (q) => q.includes("渋谷"),
    suggestions: [
      "道玄坂",
      "宇田川町",
      "宮益坂",
      "神泉",
      "桜丘町",
      "円山町",
      "表参道",
      "代官山",
    ],
  },
];

/**
 * 中心地点に応じて、追加探索向けの周辺地点候補を返す。
 * 該当するエリアが無い場合は空配列を返す (汎用候補は今後の拡張で追加する)。
 */
export function suggestExplorationCenters(centerQuery: string): string[] {
  const trimmed = centerQuery.trim();
  const entry = CENTER_SUGGESTIONS_TABLE.find(({ matches }) => matches(trimmed));
  if (!entry) return [];
  return entry.suggestions.filter((candidate) => candidate !== trimmed);
}

/** 半径選択肢 (メートル)。`registration-mode-card.tsx` の RADIUS_OPTIONS と同じ値。 */
const RADIUS_STEPS = [500, 1000, 2000, 3000];

/**
 * 現在の半径より大きい半径候補を返す (昇順)。
 * 例: 500 → [1000, 2000, 3000] / 3000 → []
 */
export function suggestLargerRadii(radiusMeters: number): number[] {
  return RADIUS_STEPS.filter((r) => r > radiusMeters);
}

/** 追加探索の種別。 */
export type ExplorationKind = "keyword" | "center" | "radius";

/**
 * 探索条件 (種別 + キーワード + 中心地点 + 半径) から一意なIDを作る。
 * 同一条件の重複実行を防ぐためのキーとしても使う。
 */
export function buildExplorationRunId(
  kind: ExplorationKind,
  keyword: string,
  centerQuery: string,
  radiusMeters: number,
): string {
  return `${kind}:${keyword.trim()}:${centerQuery.trim()}:${radiusMeters}`;
}

/**
 * 検索結果 (`AreaSearchPlaceViewModel`) の距離・範囲内外判定を、
 * 指定した中心地点・半径基準で再計算した新しいオブジェクトを返す。
 *
 * 追加探索 (別キーワード/周辺地点/半径拡張) の結果はそれぞれ異なる中心地点・半径で
 * 取得されるため、統合後は「メインの中心地点・半径」を基準に判定し直す。
 */
export function recomputeViewModel(
  vm: AreaSearchPlaceViewModel,
  center: SearchCenter,
  radiusMeters: number,
): AreaSearchPlaceViewModel {
  const distance = distanceMeters(center.lat, center.lng, vm.place.lat, vm.place.lng);
  return {
    ...vm,
    distanceMeters: distance,
    isWithinRadius: distance <= radiusMeters,
  };
}
