"use server";

import { revalidateTag } from "next/cache";
import {
  resetMockDb,
  clearMockDb,
  restoreMockDb,
  snapshotMockDb,
} from "@/lib/mock/db";
import { CACHE_TAGS } from "@/lib/cache";
import { failure, success, type ActionResult } from "./_helpers";

function invalidateAll() {
  for (const tag of [
    CACHE_TAGS.stores,
    CACHE_TAGS.research,
    CACHE_TAGS.deals,
    CACHE_TAGS.handoffs,
    CACHE_TAGS.stats,
    CACHE_TAGS.kpi,
    CACHE_TAGS.pipeline,
    CACHE_TAGS.actionQueue,
  ]) {
    revalidateTag(tag, "max");
  }
}

export async function resetToSeedAction(): Promise<ActionResult> {
  resetMockDb();
  invalidateAll();
  return success(undefined, "シードデータにリセットしました");
}

export async function clearAllAction(): Promise<ActionResult> {
  clearMockDb();
  invalidateAll();
  return success(undefined, "全データを削除しました");
}

export async function importJsonAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return failure("ファイルを選択してください");
  }
  try {
    const text = await file.text();
    const parsed = JSON.parse(text);
    restoreMockDb({
      stores: Array.isArray(parsed?.stores) ? parsed.stores : undefined,
      research: Array.isArray(parsed?.research) ? parsed.research : undefined,
      deals: Array.isArray(parsed?.deals) ? parsed.deals : undefined,
      handoffs: Array.isArray(parsed?.handoffs) ? parsed.handoffs : undefined,
    });
    invalidateAll();
    return success(undefined, "インポートに成功しました");
  } catch (e) {
    return failure(
      e instanceof Error ? `JSON解析失敗: ${e.message}` : "インポートに失敗しました",
    );
  }
}

export async function getSnapshotForExportAction() {
  return snapshotMockDb();
}
