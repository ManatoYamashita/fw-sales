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
// `types/research-run.ts` は `lib/ai/research-result-schema.ts` の re-export ハブ
// (同ファイル冒頭のJSDoc参照)。上位レイヤーが `lib/ai/*` へ直接依存しないための
// 既定経路であり、本ファイルは既に同じ specifier へ型依存している。
// `isSourceLinkClickable` は zod にも I/O にも依存しない純粋述語で、
// `research-result-schema.ts` は意図的に `server-only` を持たない
// (同ファイルのコメント参照)ため、Client Component からの参照も安全。
import { isSourceLinkClickable } from "@/types/research-run";
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

/**
 * レビュー進捗文言を組み立てる(fix/ai-research-poc-like-retrieval でバグ修正)。
 *
 * 旧文言「ヒアリング必要・外部データ必要 計N件は対象外」は、Nに`not_found`
 * (確認できず)も含まれるにもかかわらずカテゴリ名を2つしか列挙しておらず、
 * 実態と乖離していた(`not_found`が多いrunほど顕在化する表示バグ)。
 */
export function formatReviewProgressLabel(
  totalItemCount: number,
  reviewableCount: number,
  decidedCount: number,
): string {
  const excludedCount = totalItemCount - reviewableCount;
  return `レビュー進捗: ${decidedCount} / ${reviewableCount} 件 (確認できず・ヒアリング必要・外部データ必要 計${excludedCount}件はレビュー対象外)`;
}

/** reviewable item のうちまだ `review_decisions` に記録が無いものを返す。 */
export function getUndecidedReviewableItems(
  items: readonly ResearchItem[],
  decisions: ReviewDecisions,
): ResearchItem[] {
  return getReviewableItems(items).filter((item) => decisions[item.key] === undefined);
}

/**
 * 未判断 reviewable item の status 別内訳
 * (feat/ai-research-quality-ux-hardening、Plan §12.1.1)。
 */
export interface UndecidedSummary {
  confirmed: number;
  inferred: number;
  conflict: number;
  /**
   * Primary CTA(「残りを採用して調査完了」)で自動採用される件数。
   * **`conflict` は含まない**(候補選択なしで自動採用してはいけないため)。
   */
  adoptable: number;
  /** 未判断 reviewable item の総数(`conflict` を含む)。 */
  total: number;
}

/**
 * 未判断 reviewable item を status 別に集計する。
 *
 * Primary CTA を押す前に「何が採用されるか」を画面に出すための純関数
 * (「残り: 確認済み 11・推定 7」「[残り18件を採用して調査完了]」)。
 * `conflict` は採用対象ではないため `adoptable` から除外し、別枠で数える。
 */
export function summarizeUndecided(
  items: readonly ResearchItem[],
  decisions: ReviewDecisions,
): UndecidedSummary {
  const undecided = getUndecidedReviewableItems(items, decisions);
  const confirmed = undecided.filter((item) => item.status === "confirmed").length;
  const inferred = undecided.filter((item) => item.status === "inferred").length;
  const conflict = undecided.filter((item) => item.status === "conflict").length;
  return {
    confirmed,
    inferred,
    conflict,
    adoptable: confirmed + inferred,
    total: undecided.length,
  };
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
 * 1. `status==="running"` の run のうち最新のもの(未レビュー結果がある状態で
 *    「それでも再調査する」(Plan §5.9)を選んだ直後でも、進行中の調査が必ず
 *    主表示になる。running中のrunは「要確認」条件に該当しないため、これを
 *    最優先にしても Plan §6 の一覧分類とは矛盾しない)。
 * 2. `status==="succeeded"` かつ `review_completed_at===null` を満たす run のうち
 *    最新のもの(未レビュー結果を再調査の失敗等で隠さない、Plan §6 と同じ考え方)。
 * 3. 上記が無ければ `runs` の先頭(呼び出し側は `started_at` 降順を保証すること)。
 *
 * `runs` は空配列でもよい(null を返す)。
 */
export function selectPrimaryResearchRun(
  runs: readonly StoreResearchRun[],
): StoreResearchRun | null {
  const running = runs.find((run) => run.status === "running");
  if (running) return running;
  const unreviewedSucceeded = runs.find(
    (run) => run.status === "succeeded" && run.review_completed_at === null,
  );
  if (unreviewedSucceeded) return unreviewedSucceeded;
  return runs[0] ?? null;
}

/**
 * running中のrunが `expires_at` を過ぎているか(stuck run判定、Plan v3.2 §17)。
 *
 * Vercel Workflow採用によりstuck run対策の主眼はWorkflow自体のタイムアウト管理に
 * 後退した(Plan §16)が、beta SDKであり実デプロイでの動作は未検証のため、
 * Workflow自体が想定外にクラッシュして `markFailedStep` すら実行されない
 * 最悪ケースへの保険として、この軽量な判定を残す。`startResearchRunAction`
 * (再調査時の二重起動ガード解除)と `ResearchProgressCard`(UI側の「処理時間が
 * 想定を超えました」表示)の両方から使う。
 *
 * 純関数。`now` は呼び出し側から渡す(決定性のため `Date.now()` を内部で呼ばない)。
 */
export function isRunStuck(
  run: Pick<StoreResearchRun, "status" | "expires_at">,
  nowIso: string,
): boolean {
  if (run.status !== "running") return false;
  return Date.parse(run.expires_at) < Date.parse(nowIso);
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

/**
 * canonical `stores.basic_info[key].source_urls` へ書き込む URL を、
 * **外部リンクとして提示してよいと確認できた source に限定**して解決する
 * (PR #180 F2、canonical source URL provenance safety fix)。
 *
 * ## 直した問題
 *
 * `source_urls` は保存されるだけの値ではなく、2 箇所で**外部へ露出**する:
 *
 * - `app/(main)/stores/[id]/_components/basic-info-field-row.tsx` が
 *   **ゲート無しの `<a href>`** としてクリック可能に描画する
 * - `lib/ai/basic-info-prompt.ts` が営業資産生成プロンプトへ「出典: …」として渡す
 *
 * どちらも `stores.basic_info` が手動入力のみだった時代に書かれており、
 * `source_urls` に値を入れる writer は本 PR の `buildAdoptedBasicInfoField` が
 * 初めてである(main 側には reader しか存在しない)。そのため既存の reader 側には
 * 安全確認が無い。
 *
 * 一方で調査レビュー UI には `isSourceLinkClickable` という**誘導防止ガード**が既にある。
 * 実機smokeで「全く無関係な別店舗のページを指す URL」が出た事故を受けて、
 * 識別確認済み(`target_match` / `competitor_match` / `contextual`)または
 * `known_store_data` のみをクリック可能にする、という判断である。
 * 採用操作がその同じ URL をガードの無い canonical 表示へ運んでしまうと、
 * 同一 PR 内でガードを迂回することになる。ここで同じ基準を適用して塞ぐ。
 *
 * ## なぜ `isVerifiedSourceForItem` を使わないか
 *
 * あちらは「confirmed の**根拠**として使ってよいか」の判定で、意味が違う。
 * ここで必要なのは「人間がクリックする / 後続 AI へ出典として渡す URL として
 * 安全と確認できているか」であり、`isSourceLinkClickable` がまさにその目的で
 * 作られている。`isVerifiedSourceForItem` を使うと、`source_urls` が実際に露出する
 * 唯一の tier である B(= `inferred`、そもそも confirmed に届かなかった項目)で
 * ほぼ常に空になり、正当な参照資料まで失われる。
 * 例: 告膳の `competitor_stores` が引用した地域ランキングページ(`contextual`)は
 * 参照資料としては妥当であり、ここでは保持されるべきである。
 *
 * ## 全件除外時に原本へ戻さない
 *
 * `pruneUnverifiedSourceIds`(表示ノイズ削減が目的)は全件落ちた場合に元の
 * `source_ids` を残すが、**本関数は残さず空配列を返す**。canonical へ書き込む値であり、
 * 「安全と確認できた出典は無い」を正しく表す方が安全側だからである。
 * `updateBasicInfoFieldAction`(手動入力経路)が `source_urls` を持たないのと同じ状態になる。
 *
 * `ResearchItem.source_ids` 自体は変更しない(調査結果画面の表示・監査用に維持する)。
 * URL の選択順(`resolved_url ?? grounding_redirect_url`)・順序・重複の扱いは
 * `resolveSourceUrls` と完全に同一。
 *
 * 純関数。入力を変更しない。
 */
export function resolveSafeSourceUrls(
  sourceIds: readonly string[],
  sourceRegistry: readonly SourceRegistryEntry[],
): string[] {
  const byId = new Map(sourceRegistry.map((entry) => [entry.id, entry]));
  const safeIds = sourceIds.filter((id) => {
    const entry = byId.get(id);
    return entry !== undefined && isSourceLinkClickable(entry);
  });
  return resolveSourceUrls(safeIds, sourceRegistry);
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
/**
 * 「編集して採用」で元の値と異なる値が入力された場合、その値の証拠になるのは
 * AIのevidence/confidenceではなく人間の編集そのものである(feat/research-review-write-integrity、
 * MAJOR10追加修正F)。元のAI evidenceは「元の値」に対する根拠であり、編集後の値を
 * 直接証明するものではないため、editedValueが元の値と異なる場合は
 * confidenceを引き継がず、source_quoteも「人間が編集した」ことを示す文言に置き換える。
 * editedValueが元の値と同一(実質未編集)の場合は、従来どおりAIの根拠をそのまま使う。
 *
 * 監査で発見(fix/ai-research-final-audit-hardening): 上記のconfidence/source_quoteの
 * 置き換えだけでは不十分で、`source_urls`が編集後もAI元item/candidateのsource_idsから
 * 無条件に解決され続けていた。これは「元の値(例: 4,000円)の根拠として実在するURL」を、
 * 人間が上書きした別の値(例: 5,000円)の根拠であるかのようにUI(`basic-info-field-row.tsx`)や
 * sales-asset生成プロンプト(`lib/ai/basic-info-prompt.ts`)へ渡してしまう誤帰属(misattribution)
 * バグだった。他のmanual入力経路(`updateBasicInfoFieldAction`)がsource_urlsを
 * 一切持たないのと同じく、編集時はsource_urlsも空にして「直接的な出典なし」を正しく表す。
 *
 * PR #180 F2: 未編集の場合も `source_urls` をそのまま解決するのではなく
 * `resolveSafeSourceUrls` を通し、外部リンクとして提示してよいと確認できた source
 * (`isSourceLinkClickable`)だけに限定する。上記と同じ「canonical の出典として
 * 提示してよいURLだけを書く」という方針の、identity 側からの補完である。
 */
const EDITED_SOURCE_QUOTE = "人間が編集した値です(直接の出典URLはありません)。";

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
    const wasEdited = options.editedValue !== undefined && options.editedValue !== candidate.value;
    return {
      value: options.editedValue ?? candidate.value,
      tier: "A",
      confidence: wasEdited ? undefined : (item.confidence ?? undefined),
      source_urls: wasEdited
        ? undefined
        : resolveSafeSourceUrls(candidate.source_ids, sourceRegistry),
      source_quote: wasEdited ? EDITED_SOURCE_QUOTE : candidate.evidence,
      filled_by: "manual",
      updated_at: now,
    };
  }

  const wasEdited = options.editedValue !== undefined && options.editedValue !== item.value;
  return {
    value: options.editedValue ?? item.value,
    tier: item.status === "confirmed" ? "A" : "B",
    confidence: wasEdited ? undefined : (item.confidence ?? undefined),
    source_urls: wasEdited ? undefined : resolveSafeSourceUrls(item.source_ids, sourceRegistry),
    source_quote: wasEdited ? EDITED_SOURCE_QUOTE : item.evidence,
    filled_by: "manual",
    updated_at: now,
  };
}
