"use server";

import { revalidateTag } from "next/cache";
import { repos } from "@/lib/repositories";
import { CACHE_TAGS } from "@/lib/cache";
import type { StageId } from "@/types/stage";
import {
  failure,
  readString,
  success,
  type ActionResult,
} from "./_helpers";

const RESULT_TO_STAGE: Record<string, StageId | undefined> = {
  送信済み: "架電済み",
  架電済み: "架電済み",
  不通: "架電済み",
  反応あり: "架電済み",
  商談化: "架電済み",
  NG: "架電済み",
  未実施: undefined,
};

export async function recordActionAction(
  storeId: string,
  _prev: ActionResult<{ nextStage: StageId | null }> | null,
  formData: FormData,
): Promise<ActionResult<{ nextStage: StageId | null }>> {
  const result = readString(formData, "result");
  const memo = readString(formData, "memo");

  const store = await repos.store.get(storeId);
  if (!store) return failure("店舗が見つかりませんでした");

  const nextStage = RESULT_TO_STAGE[result];
  const memoLine = memo ? `\n[${result}] ${memo}` : "";

  await repos.store.update(storeId, {
    ...(nextStage ? { stage: nextStage } : {}),
    memo: store.memo + memoLine,
  });

  revalidateTag(CACHE_TAGS.stores, "max");
  revalidateTag(CACHE_TAGS.store(storeId), "max");
  revalidateTag(CACHE_TAGS.stats, "max");
  revalidateTag(CACHE_TAGS.actionQueue, "max");
  revalidateTag(CACHE_TAGS.pipeline, "max");

  return success(
    { nextStage: nextStage ?? null },
    nextStage
      ? `「${result}」として記録、ステージを「${nextStage}」に更新しました`
      : `「${result}」として記録しました`,
  );
}
