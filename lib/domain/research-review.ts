/**
 * 53項目レビュー・basic_info採用・一覧分類の純関数群
 * (AI 店舗調査再設計 Plan v3.2 §4, §6, §13, §15, PR4/PR5)。
 *
 * Server Action層(`lib/actions/research-run-actions.ts`)・クエリ層
 * (`lib/queries/research.ts`)から呼ばれる、副作用のないドメインロジックのみを集約する。
 * DB I/O・Gemini呼び出しは一切行わない。
 *
 * 関連: Plan v3.2 §4(採用即時反映)、§6(一覧の要確認判定)、§13(tier決定ルール)、
 *       §15(reviewable item定義、レビュー完了条件、要確認runの選定)
 */

import type { BasicInfoField } from "@/types/basic-info";
import type {
  ResearchItem,
  ReviewDecisions,
  SourceRegistryEntry,
  StoreResearchRun,
} from "@/types/research-run";
import type { Store } from "@/types/store";

/**
 * reviewable item の定義(Plan v3.2 §15): AIが具体的な値候補を出した項目のみ。
 * `not_found` / `hearing_required` / `external_data_required` は含まない
 * (採用/却下操作自体を持たないため)。
 */
export const REVIEWABLE_STATUSES = ["confirmed", "inferred", "conflict"] as const;

export function isReviewableItem(item: Pick<ResearchItem, "status">): boolean {
  return (REVIEWABLE_STATUSES as readonly string[]).includes(item.status);
}

export function getReviewableItems(items: readonly ResearchItem[]): ResearchItem[] {
  return items.filter(isReviewableItem);
}

/** reviewable item のうちまだ `review_decisions` に記録が無いものを返す。 */
export function getUndecidedReviewableItems(
  items: readonly ResearchItem[],
  decisions: ReviewDecisions,
): ResearchItem[] {
  return getReviewableItems(items).filter((item) => decisions[item.key] === undefined);
}

/**
 * レビュー完了条件(Plan v3.2 §15): reviewable item 全件が
 * `adopted`/`rejected`/`skipped` のいずれかで記録されていること。
 */
export function isReviewFullyDecided(
  items: readonly ResearchItem[],
  decisions: ReviewDecisions,
): boolean {
  return getUndecidedReviewableItems(items, decisions).length === 0;
}

/**
 * `/research/[storeId]` に主表示する run を選ぶ(Plan v3.2 §6, §9 の考え方を
 * 単一店舗の run 一覧に適用したもの)。
 *
 * 優先順位:
 * 1. `status==="succeeded"` かつ `review_completed_at===null` を満たす run のうち
 *    最新のもの(未レビュー結果を再調査の失敗等で隠さない、Plan §6 と同じ考え方)。
 * 2. 上記が無ければ `runs` の先頭(呼び出し側は `started_at` 降順を保証すること)。
 *
 * `runs` は空配列でもよい(null を返す)。
 */
export function selectPrimaryResearchRun(
  runs: readonly StoreResearchRun[],
): StoreResearchRun | null {
  const unreviewedSucceeded = runs.find(
    (run) => run.status === "succeeded" && run.review_completed_at === null,
  );
  if (unreviewedSucceeded) return unreviewedSucceeded;
  return runs[0] ?? null;
}

export interface ResearchQueueBuckets {
  /** 要確認: 未レビューのsucceeded runが1件以上存在する店舗。 */
  needsReview: Store[];
  /** 調査待ち: 要確認に該当せず、`stage==="未調査"` の店舗。 */
  waiting: Store[];
  /** 調査済み: 要確認に該当せず、`stage∈{"調査済み","架電済み"}` の店舗。 */
  done: Store[];
}

/**
 * `/research` 一覧の3タブ分類(Plan v3.2 §6)。相互排他になるよう
 * 「要確認 → 調査待ち → 調査済み」の優先順位で判定する。
 *
 * `needsReviewStoreIds` は `ResearchRunRepository.listStoreIdsNeedingReview()` の
 * 結果(succeeded かつ review_completed_at IS NULL のrunが存在する店舗id集合)を渡す。
 * これにより、再調査が失敗しても古い未レビューのsucceeded runが「要確認」から
 * 消えない(Plan §6)。
 *
 * 純関数。`stores` の順序を保ったまま3バケットに振り分ける。
 */
export function classifyResearchQueue(
  stores: readonly Store[],
  needsReviewStoreIds: ReadonlySet<string>,
): ResearchQueueBuckets {
  const buckets: ResearchQueueBuckets = { needsReview: [], waiting: [], done: [] };
  for (const store of stores) {
    if (needsReviewStoreIds.has(store.id)) {
      buckets.needsReview.push(store);
    } else if (store.stage === "未調査") {
      buckets.waiting.push(store);
    } else {
      buckets.done.push(store);
    }
  }
  return buckets;
}

/** Source Registry の id から実際に開ける URL を解決する(resolved_url優先、無ければ redirect URL)。 */
export function resolveSourceUrls(
  sourceIds: readonly string[],
  sourceRegistry: readonly SourceRegistryEntry[],
): string[] {
  const byId = new Map(sourceRegistry.map((entry) => [entry.id, entry]));
  const urls: string[] = [];
  for (const id of sourceIds) {
    const entry = byId.get(id);
    if (!entry) continue;
    urls.push(entry.resolved_url ?? entry.grounding_redirect_url);
  }
  return urls;
}

export interface AdoptOptions {
  /** status="conflict" の項目で候補を選んだ場合のみ指定。 */
  selectedCandidateId?: string;
  /** 「編集して採用」時の最終値。未指定なら候補/item の値をそのまま使う。 */
  editedValue?: string;
}

/**
 * 採用(adopted)された `ResearchItem` から `stores.basic_info` へ書き込む
 * `BasicInfoField` を組み立てる(Plan v3.2 §13)。
 *
 * tier決定ルール:
 * - `status==="confirmed"` → "A"
 * - `status==="inferred"` → "B"
 * - `status==="conflict"` で候補選択 → 人間が明示的に選んだ時点で確定扱い "A"
 *
 * reviewable でない item(`not_found`/`hearing_required`/`external_data_required`)は
 * 採用操作自体が存在しないため、呼び出し側で事前に `isReviewableItem` を検証すること
 * (本関数はその前提の下で例外を投げずに動作する)。
 *
 * 純関数。入力を変更しない。
 */
export function buildAdoptedBasicInfoField(
  item: ResearchItem,
  sourceRegistry: readonly SourceRegistryEntry[],
  now: string,
  options: AdoptOptions = {},
): BasicInfoField {
  if (item.status === "conflict") {
    if (options.selectedCandidateId === undefined) {
      throw new Error("conflict項目の採用には候補の選択が必須です");
    }
    const candidate = (item.candidates ?? []).find(
      (c) => c.candidate_id === options.selectedCandidateId,
    );
    if (!candidate) {
      throw new Error(`候補が見つかりません: ${options.selectedCandidateId}`);
    }
    return {
      value: options.editedValue ?? candidate.value,
      tier: "A",
      confidence: item.confidence ?? undefined,
      source_urls: resolveSourceUrls(candidate.source_ids, sourceRegistry),
      source_quote: candidate.evidence,
      filled_by: "manual",
      updated_at: now,
    };
  }

  return {
    value: options.editedValue ?? item.value,
    tier: item.status === "confirmed" ? "A" : "B",
    confidence: item.confidence ?? undefined,
    source_urls: resolveSourceUrls(item.source_ids, sourceRegistry),
    source_quote: item.evidence,
    filled_by: "manual",
    updated_at: now,
  };
}
