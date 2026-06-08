/**
 * store-basic-info ドメイン型 (Issue #114 / #121)
 *
 * 各店舗が「8 カテゴリ 50 項目の基本情報 (`basic_info`)」を単一の構造化セットとして
 * 保持するための型を定義する。1 項目分の値とメタ (`BasicInfoField`)、店舗の基本情報
 * セット全体 (`BasicInfo`)、各項目を充填した取得ソース種別 (`FillSource`) からなる。
 *
 * 充填ソースは Places / 手動の 2 系統 (#121 で Stage 2 構造化を生成経路から撤去したため
 * `ai` は廃止)。本ファイルは純粋な型定義のみを持ち、ランタイム挙動を持たない。
 * 項目の定義表 (`BASIC_INFO_ITEMS`) は別ファイル (`lib/domain/basic-info-items.ts`)
 * が単一の真実として所有する (原典 Issue #43 §2 と一致した実体 50 項目、task 4.2 で表記整合済)。
 *
 * 関連: design.md §Data Models / Logical Data Model, requirements.md §2.1
 */

/**
 * 基本情報項目を充填した取得ソース種別。
 *
 * - `places`: エリア検索 (Google Places) の公開地図情報由来。
 * - `manual`: 営業担当者の手動入力由来 (以後の自動充填から保護される)。
 *
 * 競合解決の優先ソース (`primary`) もこの 2 値で表現する。
 */
export type FillSource = "places" | "manual";

/**
 * 基本情報 1 項目分の値とメタ情報。`BasicInfo` の各値。
 *
 * `tier` は取得難易度区分:
 * - A: Web で高信頼に取得可能 (value 必須、出典は任意)。
 * - B: 推定 (value + confidence + source_urls + source_quote が必須)。
 * - C: 店主ヒアリング必須 (value は null 可、hearing_question が必須)。
 *
 * `filled_by` が `null` の場合は未充足。`updated_at` は境界を越える際に文字列化する
 * 既存規約に合わせ ISO 8601 文字列で保持する。
 */
export interface BasicInfoField {
  value: string | null;
  tier: "A" | "B" | "C";
  /** 0-100。tier=B で必須。 */
  confidence?: number;
  /** 出典 URL 群。tier=B で必須。 */
  source_urls?: string[];
  /** 出典抜粋。tier=B で必須。 */
  source_quote?: string;
  /** 店主への確認質問。tier=C で必須。 */
  hearing_question?: string;
  /** 充填した取得ソース。未充足時は null。 */
  filled_by: FillSource | null;
  /** 更新時刻 (ISO 8601 文字列)。 */
  updated_at: string;
}

/**
 * 店舗の基本情報セット全体。キーは `BASIC_INFO_ITEMS` の既知キー
 * (`lib/domain/basic-info-items.ts` が所有)。未充足項目も枠として保持する。
 */
export type BasicInfo = Record<string, BasicInfoField>;
