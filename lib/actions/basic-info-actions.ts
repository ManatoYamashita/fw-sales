"use server";

/**
 * 基本情報 (`basic_info`) の手動編集 Server Action (store-basic-info / task 3.3, PR2)
 *
 * 店舗詳細の `BasicInfoFieldsCard` から呼ばれ、ユーザーが個別項目を編集した値を
 * `mergeBasicInfo(..., "manual")` 経由で永続化する。`filled_by="manual"` を強制し
 * 以後の自動充填(Places 等)で当該項目が上書きされないよう保護する(R5.1 / R6.2)。
 *
 * 既存スカラー編集の `updateStorePatchAction` とは責務を分ける:
 * - スカラー (name/address/genre 等) の編集 → `updateStorePatchAction`
 * - basic_info 1 項目の手動編集 → 本 action (source="manual" 強制)
 *
 * 入力検証:
 * - storeId 必須
 * - key は `BASIC_INFO_ITEMS` の既知キーのみ(防御的検証)
 * - value が trim 後空文字なら `value: null` を保存(「未充足に戻す」操作)
 *
 * 関連: requirements.md §6.1 §6.2, design.md §UI / BasicInfoCard §System Flows 充填マージ
 */

import { revalidateTag } from "next/cache";
import { repos } from "@/lib/repositories";
import { CACHE_TAGS } from "@/lib/cache";
import { BASIC_INFO_ITEM_BY_KEY } from "@/lib/domain/basic-info-items";
import { mergeBasicInfo } from "@/lib/domain/basic-info-merge";
import type { BasicInfo, BasicInfoField } from "@/types/basic-info";
import { failure, success, type ActionResult } from "./_helpers";

/**
 * 基本情報の 1 項目を手動編集し、`filled_by="manual"` で永続化する。
 *
 * @param storeId 編集対象の店舗 ID
 * @param key     基本情報項目キー (`BASIC_INFO_ITEMS` に存在すること)
 * @param value   編集後の値。trim 後空文字なら未充足扱い (`value: null`)
 * @returns       `ActionResult<void>`。エラーは failure メッセージで返す
 */
export async function updateBasicInfoFieldAction(
  storeId: string,
  key: string,
  value: string,
): Promise<ActionResult<void>> {
  // storeId 検証
  if (typeof storeId !== "string" || storeId.trim() === "") {
    return failure("店舗 ID が指定されていません");
  }

  // key 検証 (BASIC_INFO_ITEMS が単一の真実)
  const def = BASIC_INFO_ITEM_BY_KEY.get(key);
  if (!def) {
    return failure(`未知の項目キーです: ${key}`);
  }

  // value: trim 後空なら未充足 (value=null)、それ以外は trim 済み文字列
  const trimmed = value.trim();
  const fieldValue: string | null = trimmed === "" ? null : trimmed;

  // 手動編集された field を組み立てる。
  // tier は項目の default_tier を採用(編集時に区分を変える UI は現段階で持たない)。
  // filled_by/updated_at は `mergeBasicInfo` (repository) が source="manual" と now で
  // 上書きするため、ここで偽装してもマージ側が真実をスタンプする(防御の二重化)。
  const field: BasicInfoField = {
    value: fieldValue,
    tier: def.default_tier,
    filled_by: "manual",
    updated_at: new Date().toISOString(),
  };
  const incoming: Partial<BasicInfo> = { [key]: field };

  try {
    // feat/ai-research-quality-ux-hardening(Plan 12.2.2): 行ロック付き read-merge-write。
    //
    // 旧実装は `repos.store.mergeBasicInfo`(トランザクション外・行ロック無しの
    // read-merge-write)を直接呼んでいた。`stores` の更新は**全列 SET** のため、
    // review 側の書込み(個別採用 / 一括採用 / 「残りを採用して調査完了」)と
    // 並行実行されると後着が先着を丸ごと巻き戻す lost update が発生しうる。
    // とくに「残りを採用して調査完了」は約30 key を一度に書くため被害が大きい。
    //
    // ロック順は `stores` のみ(review 系は run -> store)。
    // `stores` -> `store_research_runs` の順で明示ロックを取る経路は存在しないため、
    // 新しい deadlock クラスは発生しない。
    await repos.transaction(async (tx) => {
      const store = await tx.store.getForUpdate(storeId);
      if (!store) throw new Error(`Store not found: ${storeId}`);
      const merged = mergeBasicInfo(store.basic_info, incoming, "manual", new Date().toISOString());
      await tx.store.update(storeId, { basic_info: merged });
    });
    // store 詳細 / 一覧キャッシュを無効化
    revalidateTag(CACHE_TAGS.store(storeId), "max");
    revalidateTag(CACHE_TAGS.stores, "max");
    return success(undefined, `「${def.label}」を更新しました`);
  } catch (err) {
    // 未存在 id 等を failure に正規化
    const message =
      err instanceof Error ? err.message : "基本情報の更新に失敗しました";
    return failure(message);
  }
}
