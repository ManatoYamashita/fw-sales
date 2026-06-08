/**
 * 基本情報マージ純関数 (store-basic-info / Issue #114, #121)
 *
 * 現在の `BasicInfo` に 1 ソース分の部分更新を当てて新しい `BasicInfo` を返す純関数。
 * `store-repository.mergeBasicInfo` の中核ロジックを副作用ゼロで実装し、Action 層と
 * UI 層から独立して単体検証できるようにする。
 *
 * マージ規則 (design.md §Domain / mergeBasicInfo, requirements 5.x / 6.x):
 * - `source === "manual"`         → 常に上書き (手動編集が最強)
 * - 既存 `filled_by === "manual"` → 自動ソースは保持 (R5.1, R6.2 手動値の保護)
 * - `BASIC_INFO_ITEMS[key].primary === source` → 上書き (R5.2 優先ソース一致)
 * - それ以外の自動ソース          → 既存値が空 (null / 空文字) のときのみ補完 (R5.3)
 *
 * 不変条件:
 * - 入力 (`current` / `incoming`) を一切変更しない (新オブジェクト返却)
 * - 出力キー集合 ⊇ `current` のキー集合
 * - 採用された値の `filled_by` は `source` 引数で確定、`updated_at` は `now` でスタンプ
 *
 * 決定性:
 * - `now` は引数で受け取り関数内で `Date.now()` を呼ばない。テストでも本番でも
 *   呼び出し側が同じ now を渡せば同じ結果になる。
 *
 * 関連: design.md §Domain / mergeBasicInfo, requirements.md §5.1 §5.2 §5.3 §6.1 §6.2
 */

import type {
  BasicInfo,
  BasicInfoField,
  FillSource,
} from "@/types/basic-info";
import { BASIC_INFO_ITEM_BY_KEY } from "./basic-info-items";

/** value が未充足 (null / 空文字 / 空白のみ) と判定する。`undefined` field も未充足扱い。 */
function isEmpty(field: BasicInfoField | undefined): boolean {
  if (!field) return true;
  if (field.value === null) return true;
  if (typeof field.value === "string" && field.value.trim() === "") return true;
  return false;
}

/** 採用された候補値に取得ソースと更新時刻をスタンプして返す (入力非変更)。 */
function stampField(
  candidate: BasicInfoField,
  source: FillSource,
  now: string,
): BasicInfoField {
  return {
    ...candidate,
    filled_by: source,
    updated_at: now,
  };
}

/**
 * `current` に `incoming`(1 ソース分)を当ててマージした新しい `BasicInfo` を返す。
 *
 * @param current  店舗の現在の基本情報。本関数は変更しない。
 * @param incoming 当該ソースが提供する部分更新。キーは `BASIC_INFO_ITEMS` の既知キー。
 *                 未知キーは無視する (precondition violation 防御)。
 * @param source   当該充填の取得ソース (`"places"` | `"manual"`)。採用値に必ずスタンプされる。
 * @param now      採用値の `updated_at` に書き込む ISO 8601 文字列。決定性のため引数化。
 * @returns        マージ後の新しい `BasicInfo`。入力は不変。
 */
export function mergeBasicInfo(
  current: BasicInfo,
  incoming: Partial<BasicInfo>,
  source: FillSource,
  now: string,
): BasicInfo {
  // 不変条件「出力キー集合 ⊇ current のキー集合」を担保するため current を起点に複製
  const result: BasicInfo = { ...current };

  for (const [key, candidate] of Object.entries(incoming)) {
    if (candidate === undefined) continue;
    // 未知キーは無視 (BASIC_INFO_ITEMS が単一の真実)
    const def = BASIC_INFO_ITEM_BY_KEY.get(key);
    if (!def) continue;

    const existing = current[key];

    // manual は常に上書き (手動編集が最強)
    if (source === "manual") {
      result[key] = stampField(candidate, source, now);
      continue;
    }

    // 既存値が手動編集 → 自動ソースは保持 (R5.1, R6.2)
    if (existing !== undefined && existing.filled_by === "manual") {
      continue;
    }

    // 当該項目の優先ソース一致 → 上書き (R5.2)
    if (def.primary === source) {
      result[key] = stampField(candidate, source, now);
      continue;
    }

    // 非 primary の自動ソースは空欄補完のみ (R5.3)
    if (isEmpty(existing)) {
      result[key] = stampField(candidate, source, now);
    }
    // else: 既存値を保持(候補を捨てる)
  }

  return result;
}
