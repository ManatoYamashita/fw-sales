"use server";

import { revalidateTag } from "next/cache";
import { redirect } from "next/navigation";
import { repos } from "@/lib/repositories";
import { CACHE_TAGS } from "@/lib/cache";
import { CHANNELS, type Channel } from "@/types/store";
import type { ResearchInput } from "@/types/research";
import {
  failure,
  readString,
  success,
  type ActionResult,
} from "./_helpers";

function asChannel(value: string): Channel {
  return (CHANNELS as readonly string[]).includes(value)
    ? (value as Channel)
    : "未判定";
}

function buildResearchInput(
  formData: FormData,
  storeId: string,
  storeName: string,
): ResearchInput {
  return {
    store_id: storeId,
    store_name: storeName,
    total_review: readString(formData, "total_review"),
    strength1: readString(formData, "strength1"),
    strength2: readString(formData, "strength2"),
    strength3: readString(formData, "strength3"),
    weakness1: readString(formData, "weakness1"),
    weakness2: readString(formData, "weakness2"),
    weakness3: readString(formData, "weakness3"),
    review_positive: readString(formData, "review_positive"),
    review_negative: readString(formData, "review_negative"),
    meo_gap: readString(formData, "meo_gap"),
    hp_gap: readString(formData, "hp_gap"),
    instagram_gap: readString(formData, "instagram_gap"),
    channel: asChannel(readString(formData, "channel")),
    channel_reason: readString(formData, "channel_reason"),
    sales_hook: readString(formData, "sales_hook"),
    entry_product: readString(formData, "entry_product"),
    main_product: readString(formData, "main_product"),
    researcher: readString(formData, "researcher") || "佐藤",
    status: "完了",
  };
}

export async function saveResearchAction(
  storeId: string,
  _prev: ActionResult<{ researchId: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ researchId: string }>> {
  const store = await repos.store.get(storeId);
  if (!store) return failure("店舗が見つかりませんでした");

  const input = buildResearchInput(formData, storeId, store.name);

  try {
    // 研究 save と店舗 stage/channel 同期を 1 トランザクションで原子化
    // (research-handoff-db-migration §4.1, §4.2, §4.4, §4.5)。
    const saved = await repos.transaction(async ({ research, store: storeTx }) => {
      const existing = await research.getByStoreId(storeId);
      const r = existing
        ? await research.update(existing.id, input)
        : await research.create(input);
      if (!r) throw new Error("保存に失敗しました");

      // 店舗ステージ・チャネル同期。stage は「調査待ち」のときのみ「調査完了」へ遷移。
      await storeTx.update(storeId, {
        stage: store.stage === "調査待ち" ? "調査完了" : store.stage,
        channel: input.channel,
      });

      return r;
    });

    // tx 成功後にのみ revalidateTag を呼ぶ。失敗時はキャッシュ汚染しない。
    revalidateTag(CACHE_TAGS.research, "max");
    revalidateTag(CACHE_TAGS.researchByStore(storeId), "max");
    revalidateTag(CACHE_TAGS.stores, "max");
    revalidateTag(CACHE_TAGS.store(storeId), "max");
    revalidateTag(CACHE_TAGS.stats, "max");
    revalidateTag(CACHE_TAGS.actionQueue, "max");
    revalidateTag(CACHE_TAGS.pipeline, "max");

    return success({ researchId: saved.id }, "調査結果を保存しました");
  } catch (err) {
    return failure(err instanceof Error ? err.message : "保存に失敗しました");
  }
}

export async function saveResearchAndContinue(
  storeId: string,
  formData: FormData,
) {
  const result = await saveResearchAction(storeId, null, formData);
  if (!result.ok) {
    throw new Error(result.error);
  }
  redirect(`/stores/${storeId}`);
}
