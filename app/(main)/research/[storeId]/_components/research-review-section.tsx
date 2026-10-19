"use client";

/**
 * 53項目レビューセクション(Plan v3.2 §5.3)。カテゴリごとの折りたたみ(`<details>`)・
 * 「未判断の項目のみ表示」フィルタ・レビュー完了(sticky footer)を提供する。
 *
 * ## 主ボタンの意味 (#301, #319)
 *
 * 旧主ボタン「残りN件を採用して調査完了」は、未判断の確認済みと**推定**をまとめて採用し、
 * いまの基本情報を**無条件に上書き**していた。本番では、推定 15 件を見ないまま採用する操作が
 * いちばん押しやすく、再調査した店舗では既存の基本情報 24〜25 件が言い換えや情報の落ちた値で
 * 置き換わるところだった。
 *
 * 未判断の項目は `planReviewLanes` (`lib/domain/research-review.ts`) で振り分ける。
 * サーバ(`adoptBulkLaneAction`)も同じ関数で計算し直す。
 *
 * - まとめて採用 (`bulk`): 採用しても値が変わらない項目と、注記の無い確認済みの新規の項目
 * - 1件ずつ確認 (`individual`): 上書きになる値・注記ありの値・推定の値。カードを開いておく
 * - 候補の選択 (`choose`): 競合
 *
 * 主ボタンは状態ごとに 1 つ:
 * - `bulk` がある → 「N件をまとめて採用」。採用後に何も残らないなら「N件を採用して調査完了」
 * - `bulk` が無く未判断が残る → 「次の未判断の項目へ」(カードへ移動する)
 * - 未判断が無い → 「レビュー完了」
 *
 * 副ボタン「残りN件は反映せずに完了」は、未判断を基本情報に反映せずに閉じる
 * (`completeReviewAction` の skipRemaining)。本番で再調査した 2 店舗はこの操作で閉じている。
 */

import { useId, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ChevronDown, Check } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { ResearchItemCard, type DecideInput, toPendingDecision, pendingDecisionForItem, type PendingDecision } from "./research-item-card";
import { NonReviewItemCard } from "./research-nonreview-card";
import { runAction } from "@/lib/client/run-action";
import {
  adoptBulkLaneAction,
  completeReviewAction,
  recordReviewDecisionAction,
} from "@/lib/actions/research-run-actions";
import {
  BASIC_INFO_ITEM_BY_KEY,
  CATEGORY_LABELS,
  type CategoryKey,
} from "@/lib/domain/basic-info-items";
import {
  getReviewableItems,
  isReviewableItem,
  planReviewLanes,
  summarizeReviewPlan,
  type ReviewLane,
  type ReviewPlanSummary,
} from "@/lib/domain/research-review";
import {
  deriveItemTrust,
  hasIdentityMismatchWarning,
  ITEM_TRUST_LABELS,
  type ItemTrust,
} from "@/lib/domain/research-item-notes";
import { formatDateTime } from "@/lib/utils/date";
import type { Store } from "@/types/store";
import type { ResearchItem, StoreResearchRun } from "@/types/research-run";

/**
 * 見出しの件数。カードのバッジと同じ `deriveItemTrust` の区分で数え、「確認済み 17」と
 * 数えた項目のカードに「登録済み」「注記あり」と出る食い違いを作らない (#301)。
 *
 * レビュー対象の区分だけを数える (#360)。確認できず・ヒアリング必要・外部データ必要は、
 * 末尾の折りたたみ「調査で値が出なかった項目(N項目)」に件数ごと出ている。
 * 推定の意味はここで 1 回だけ添える。以前は推定の各カードに同じ注意を出しており、
 * 本番では 1 画面に 15 回並んでいた。
 */
const TRUST_COUNT_NOTES: Partial<Record<ItemTrust, string>> = {
  inferred: "AIによる分析で、断定はできません",
};

/* ------------------------------------------------------------------ */
/*  項目へのジャンプ(純関数、UIテストから直接検証する)                  */
/* ------------------------------------------------------------------ */

/**
 * review item カードへ画面内ジャンプするための安定した DOM id。
 *
 * `item.key` は 53項目の canonical key(`[a-z_]+`)であり、
 * `BASIC_INFO_ITEMS` / `RESEARCH_POLICY_ITEMS` が集合一致を保証している。
 * ラベル(日本語)ではなく key を使うことで、文言変更で anchor が壊れない。
 */
export function researchItemAnchorId(key: string): string {
  return `research-item-${key}`;
}

/**
 * 指定 item のカードへジャンプする(祖先の折りたたみを開く → スクロール → フォーカス)。
 *
 * ## 祖先 `<details>` を開く必要がある理由
 *
 * カテゴリは `<details open>` で描画されるが、`open` は **uncontrolled** な属性で、
 * ユーザーが手で閉じても React は開き直さない(React 19.2.4 の `react-dom-client` は
 * `details` に対し `toggle` の購読しか行わず、`input` のような state 復元機構を持たない)。
 * 「未判断の項目のみ表示」を ON にしても、conflict を含むカテゴリは `isUnresolved` が true を
 * 返して描画され続けるため、同じ DOM ノードが**閉じたまま**残る。
 *
 * 閉じた `<details>` の子孫は DOM には存在する(= `getElementById` は要素を返す)が
 * 描画されていないため、`scrollIntoView` はスクロールボックスを持たず実質 no-op になり、
 * `focus()` も「レンダリングされていない要素」として中止される。つまり**ユーザーには
 * 何も起きないように見える**。これはこのジャンプ機能自体の目的を壊すため、
 * スクロールの前に祖先の折りたたみを開く。
 *
 * ## 環境安全性
 *
 * `instanceof HTMLDetailsElement` は使わない。`HTMLDetailsElement` は SSR や
 * vitest の node environment に存在せず、参照するだけで `ReferenceError` になる
 * (cross-realm でも `instanceof` は偽になりうる)。代わりに `"open" in ancestor` で
 * 判定する。`closest` を持たない stub 要素でも `?.` により安全に no-op となる。
 *
 * ネストした `<details>` にも対応するため、`closest` を1回で終わらせず祖先を辿る
 * (現状のカテゴリ折りたたみは1階層だが、将来ネストしても壊れないようにする)。
 *
 * ## 戻り値
 *
 * **「対象要素が見つかり、ジャンプ処理を開始できた」ことを表す。**
 * `scrollIntoView` / `focus` が実際に成功したかは DOM 側の判断であり保証しない。
 * DOM が無い環境(SSR / node)と対象要素が無い場合のみ `false`。
 *
 * `block: "center"` は、ジャンプ先が sticky footer やページヘッダの裏に
 * 隠れないようにするため(footer は画面下端に固定されている)。
 * `focus({ preventScroll: true })` はスクロール位置を二重に動かさないため。
 */
export function scrollToResearchItem(key: string): boolean {
  return scrollToReviewElement(researchItemAnchorId(key));
}

/** 閉じたカテゴリも開いて移動し、キーボードの操作位置も合わせます。 */
export function scrollToReviewElement(id: string): boolean {
  if (typeof document === "undefined") return false;
  // Next.jsが別店舗の画面を非表示で保持していても、現在のレビューだけを探します。
  const activeRoot = Array.from(document.querySelectorAll?.("[data-research-review]") ?? [])
    .find((root) => root.getClientRects().length > 0);
  const el = activeRoot
    ? Array.from(activeRoot.querySelectorAll<HTMLElement>("[id]")).find((element) => element.id === id) ?? null
    : document.getElementById(id);
  if (el === null) return false;

  let ancestor: Element | null = el.closest?.("details") ?? null;
  while (ancestor !== null) {
    if ("open" in ancestor) (ancestor as { open: boolean }).open = true;
    ancestor = ancestor.parentElement?.closest?.("details") ?? null;
  }

  const reducedMotion = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  el.scrollIntoView?.({ behavior: reducedMotion ? "instant" : "smooth", block: "center" });
  el.focus?.({ preventScroll: true });
  return true;
}

/**
 * 「未判断の項目のみ表示」を ON にした**後**の DOM に対してスクロールする。
 *
 * `setState` は同期的に DOM へ反映されないため、次フレームまで待つ。
 * `requestAnimationFrame` が無い環境では `setTimeout(0)` へ退避する。
 */
function deferScrollToResearchItem(key: string): void {
  const run = () => {
    scrollToResearchItem(key);
  };
  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(() => requestAnimationFrame(run));
    return;
  }
  setTimeout(run, 0);
}

/**
 * ジャンプCTAの動作: 「未判断の項目のみ表示」を ON にしてから対象itemへ移動する。
 *
 * scroll 実装を差し替え可能な引数にしてあるのは、DOM 無しでも
 * 「filter ON → 対象keyへ移動」という順序と引数を単体テストで固定するため。
 */
export function handleItemJump(
  key: string,
  setFilterUnresolved: (next: boolean) => void,
  scroll: (key: string) => void = deferScrollToResearchItem,
): void {
  setFilterUnresolved(true);
  scroll(key);
}

/* ------------------------------------------------------------------ */
/*  フッターの文言(純関数)                                            */
/* ------------------------------------------------------------------ */

export type ReviewPrimaryAction =
  | { kind: "bulk"; label: string; keys: string[]; complete: boolean }
  | { kind: "next"; label: string; targetKey: string }
  | { kind: "complete"; label: string };

export interface ReviewFooterModel {
  /** 「まとめて採用: 6件（新規 1・変更なし 5）」。まとめて採用する項目が無ければ null。 */
  bulkLine: string | null;
  /** 「1件ずつ確認: 上書き 25・推定 10」。主ボタンの後に判断が要る項目が無ければ null。 */
  remainingLine: string | null;
  primary: ReviewPrimaryAction;
  /** 副ボタン(未判断を反映せずに完了)の文言。未判断が無ければ null。 */
  skipLabel: string | null;
}

function joinCounts(parts: [string, number][]): string {
  return parts
    .filter(([, count]) => count > 0)
    .map(([label, count]) => `${label} ${count}`)
    .join("・");
}

/**
 * 振り分けの件数から、フッターの内訳・主ボタン・副ボタンの文言を組み立てる。
 *
 * 主ボタンは**上書きにならない項目だけ**を採用する。上書きの件数は押す前に
 * 「1件ずつ確認」の内訳として見えており、押しても基本情報は書き換わらない (#319)。
 */
export function buildReviewFooterModel(summary: ReviewPlanSummary): ReviewFooterModel {
  const bulkCount = summary.bulkKeys.length;
  const bulkLine =
    bulkCount > 0
      ? `まとめて採用: ${bulkCount}件（${joinCounts([
          ["新規", summary.bulk.new],
          ["変更なし", summary.bulk.same],
        ])}）`
      : null;

  const remainingText = joinCounts([
    ["上書き", summary.individual.overwrite],
    ["注記あり", summary.individual.noted],
    ["推定", summary.individual.inferred],
    ["登録済み", summary.individual.registered],
    ["候補の選択", summary.choose],
  ]);
  const remainingLine = summary.remainingKeys.length > 0 ? `1件ずつ確認: ${remainingText}` : null;

  let primary: ReviewPrimaryAction;
  if (bulkCount > 0) {
    const complete = summary.remainingKeys.length === 0;
    primary = {
      kind: "bulk",
      label: complete ? `${bulkCount}件を採用して調査完了` : `${bulkCount}件をまとめて採用`,
      keys: summary.bulkKeys,
      complete,
    };
  } else if (summary.remainingKeys.length > 0) {
    primary = { kind: "next", label: "次の未判断の項目へ", targetKey: summary.remainingKeys[0]! };
  } else {
    primary = { kind: "complete", label: "レビュー完了" };
  }

  return {
    bulkLine,
    remainingLine,
    primary,
    skipLabel: summary.total > 0 ? `残り${summary.total}件は反映せずに完了` : null,
  };
}

interface Props {
  store: Store;
  run: StoreResearchRun;
  onUpdate: (next: StoreResearchRun) => void;
  onRestart: () => void;
  restarting: boolean;
}

export function ResearchReviewSection({ store, run, onUpdate, onRestart, restarting }: Props) {
  const router = useRouter();
  const categorySelectId = useId();
  const items = useMemo(() => run.result ?? [], [run.result]);
  const [filterUnresolved, setFilterUnresolved] = useState(false);
  const [busy, startTransition] = useTransition();
  // 項目の判断で、いま処理中なのはどの項目のどのボタンか (#337)。transition の
  // 終わりで消さなくてよい: 表示は `busy` の間だけ効かせ、次に押したら上書きする。
  const [pendingDecision, setPendingDecision] = useState<
    (PendingDecision & { itemKey: string }) | null
  >(null);
  const [completing, startCompleting] = useTransition();

  const reviewCompleted = run.review_completed_at !== null;
  const reviewableItems = useMemo(() => getReviewableItems(items), [items]);

  const plan = useMemo(
    () => planReviewLanes(items, run.review_decisions, store.basic_info),
    [items, run.review_decisions, store.basic_info],
  );
  const laneByKey = useMemo(
    () => new Map<string, ReviewLane>(plan.map((entry) => [entry.item.key, entry.lane])),
    [plan],
  );
  const planSummary = useMemo(() => summarizeReviewPlan(plan), [plan]);
  const footer = useMemo(() => buildReviewFooterModel(planSummary), [planSummary]);

  const trustCounts = useMemo(() => {
    const counts = new Map<ItemTrust, number>();
    for (const item of items) {
      const trust = deriveItemTrust(item);
      if (trust !== null) counts.set(trust, (counts.get(trust) ?? 0) + 1);
    }
    return counts;
  }, [items]);
  const identityMismatch = hasIdentityMismatchWarning(run.warnings);

  /** レビュー対象の項目だけをカテゴリごとに並べる。値の出なかった項目は末尾に 1 つの折りたたみへまとめる。 */
  const grouped = useMemo(() => {
    const map = new Map<CategoryKey, ResearchItem[]>();
    for (const item of reviewableItems) {
      const category = BASIC_INFO_ITEM_BY_KEY.get(item.key)?.category ?? "category_1_basic";
      const arr = map.get(category) ?? [];
      arr.push(item);
      map.set(category, arr);
    }
    return map;
  }, [reviewableItems]);
  const nonReviewItems = useMemo(() => items.filter((item) => !isReviewableItem(item)), [items]);

  const isUndecided = (item: ResearchItem): boolean => laneByKey.has(item.key);
  const visibleGroups = Array.from(grouped.entries())
    .map(([category, categoryItems]) => ({
      category,
      categoryItems,
      visibleItems: filterUnresolved ? categoryItems.filter(isUndecided) : categoryItems,
      remaining: categoryItems.filter(isUndecided).length,
    }))
    .filter(({ visibleItems }) => visibleItems.length > 0);
  const decidedCount = reviewableItems.length - plan.length;

  const onDecide = (item: ResearchItem, input: DecideInput) => {
    if (reviewCompleted) return;
    setPendingDecision({ itemKey: item.key, ...toPendingDecision(input) });
    startTransition(async () => {
      // 項目ごとの判断は数十件を続けて押すため、成功はトーストではなく項目の
      // 表示が変わることで伝える (#327 で決定)。失敗と例外はトーストで出す。
      const res = await runAction(
        () =>
          recordReviewDecisionAction({
            runId: run.id,
            storeId: store.id,
            itemKey: item.key,
            decision: input.decision,
            selectedCandidateId: input.selectedCandidateId,
            editedValue: input.editedValue,
          }),
        { silentSuccess: true },
      );
      if (res?.ok) {
        onUpdate({ ...run, review_decisions: res.data.reviewDecisions });
        // 採用で基本情報が変わると、ほかの項目の「いまの値」との比較には影響しないが、
        // 店舗の表示(store prop)はサーバ側の確定値で取り直す。
        if (input.decision === "adopted") router.refresh();
      }
    });
  };

  const onJump = (key: string) => {
    handleItemJump(key, setFilterUnresolved);
  };

  /**
   * 主ボタン。サーバの確定値(decisions・完了時刻)をそのまま使い、クライアントで捏造しない。
   */
  const onPrimary = () => {
    const primary = footer.primary;
    if (primary.kind === "next") {
      onJump(primary.targetKey);
      return;
    }
    startCompleting(async () => {
      if (primary.kind === "bulk") {
        const res = await runAction(
          () =>
            adoptBulkLaneAction({
              runId: run.id,
              storeId: store.id,
              expectedKeys: primary.keys,
              complete: primary.complete,
            }),
          { success: "採用しました" },
        );
        if (res?.ok) {
          onUpdate({
            ...run,
            review_decisions: res.data.reviewDecisions,
            review_completed_at: res.data.reviewCompletedAt,
          });
          router.refresh();
        }
        return;
      }
      const res = await runAction(
        () => completeReviewAction({ runId: run.id, storeId: store.id, skipRemaining: false }),
        { success: "レビューを完了しました" },
      );
      if (res?.ok) router.refresh();
    });
  };

  /** 副ボタン: 未判断の項目を反映せず、判断済みの内容だけで完了する。 */
  const onCompleteDecidedOnly = () => {
    startCompleting(async () => {
      const res = await runAction(
        () =>
          completeReviewAction({
            runId: run.id,
            storeId: store.id,
            skipRemaining: true,
          }),
        { success: "レビューを完了しました" },
      );
      if (res?.ok) {
        // `completeReviewAction` は decisions を返さないため、サーバー側の確定状態は
        // `router.refresh()` の再取得に委ねる(クライアントで値を捏造しない)。
        router.refresh();
      }
    });
  };

  return (
    <div data-research-review className="@container/review min-w-0">
      <div className="grid items-start gap-5 @min-[60rem]/review:grid-cols-[13rem_minmax(0,1fr)] @min-[60rem]/review:gap-6 [&_:is(button,textarea,summary,a)]:scroll-mt-24 [&_:is(button,textarea,summary,a)]:scroll-mb-[50dvh]">
        <aside className="min-w-0 @min-[60rem]/review:sticky @min-[60rem]/review:top-24 [@media(max-height:30rem)]:static">
          <div className="hidden space-y-4 @min-[60rem]/review:block">
            <div className="space-y-2 px-3">
              <p className="text-sm font-semibold text-foreground">レビューの進捗</p>
              <p className="text-sm text-muted-foreground tabular-nums">
                判断済み <span className="font-semibold text-foreground">{decidedCount}</span> / {reviewableItems.length}件
              </p>
              <progress aria-label="レビューの進捗" value={decidedCount} max={reviewableItems.length || 1} className="h-1.5 w-full accent-primary" />
            </div>
            <nav aria-label="調査カテゴリ">
              <ul className="space-y-1">
                {visibleGroups.map(({ category, categoryItems, remaining }) => (
                  <li key={category}>
                    <a
                      href={`#research-category-${store.id}-${category}`}
                      onClick={() => {
                        const target = document.getElementById(`research-category-${store.id}-${category}`);
                        if (target && "open" in target) (target as HTMLDetailsElement).open = true;
                      }}
                      className="flex min-h-11 items-start justify-between gap-3 rounded-md px-3 py-2.5 text-sm leading-relaxed text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground"
                    >
                      <span>{CATEGORY_LABELS[category]}</span>
                      <span className="shrink-0 tabular-nums">
                        {remaining === 0 ? <Check aria-label="判断済み" className="mt-0.5 size-4" /> : remaining}
                        <span className="sr-only"> / {categoryItems.length}項目</span>
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
            {!reviewCompleted && <p className="px-3 text-xs leading-relaxed text-muted-foreground">数字は未判断の項目数です。</p>}
          </div>
          <div className="space-y-2 @min-[60rem]/review:hidden">
            <label htmlFor={categorySelectId} className="block text-sm font-medium text-foreground">カテゴリへ移動</label>
            <Select
              id={categorySelectId}
              width="full"
              value=""
              disabled={visibleGroups.length === 0}
              onValueChange={scrollToReviewElement}
              placeholder={visibleGroups.length > 0 ? "確認したいカテゴリを選択" : "未判断の項目はありません"}
              options={visibleGroups.map(({ category, remaining }) => ({
                value: `research-category-${store.id}-${category}`,
                label: `${CATEGORY_LABELS[category]}（未判断 ${remaining}件）`,
              }))}
            />
          </div>
        </aside>
        <Card>
          <Card.Header>
            <div className="w-full space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3 [&>*+*]:ml-auto">
                <h2 className="text-lg font-semibold leading-snug tracking-tight text-foreground">
                  {reviewCompleted ? "調査結果" : "調査結果をレビュー"}
                </h2>
                <Badge tone={reviewCompleted ? "success" : "warning"}>
                  {reviewCompleted ? "レビュー完了" : "レビュー未完了"}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground">{formatDateTime(run.started_at)} 実施</p>
              <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm text-muted-foreground">
                {Array.from(trustCounts.entries()).map(([trust, count]) => (
                  <span key={trust}>
                    {ITEM_TRUST_LABELS[trust]} <span className="font-medium text-foreground tabular-nums">{count}件</span>
                    {TRUST_COUNT_NOTES[trust] !== undefined && <span className="block text-xs leading-relaxed">{TRUST_COUNT_NOTES[trust]}</span>}
                  </span>
                ))}
              </div>
            </div>
          </Card.Header>
          <Card.Body className="space-y-4">
            {/* run 全体の警告は店舗の不一致だけを出す (#359, #360)。本文取得の失敗などは
                各項目の「未確認の情報源」と重なる。進捗は下部の固定バーに出ている。 */}
            {identityMismatch && (
              <p className="flex items-start gap-1.5 text-xs text-warning">
                <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                <span>
                  AIが調べた店舗の名前・住所が登録情報と一致しません。別の店舗の情報が混ざっている可能性があるため、採用する前に出典を確認してください。
                </span>
              </p>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant={filterUnresolved ? "secondary" : "outline"}
                aria-pressed={filterUnresolved}
                onClick={() => setFilterUnresolved((v) => !v)}
              >
                未判断の項目のみ表示
              </Button>
            </div>

            {filterUnresolved && visibleGroups.length === 0 && (
              <p role="status" className="rounded-md bg-muted p-4 text-sm leading-relaxed text-muted-foreground">
                未判断の項目はありません。「未判断の項目のみ表示」を解除すると、判断済みの内容を確認できます。
              </p>
            )}

            {visibleGroups.map(({ category, categoryItems, visibleItems, remaining }) => {
              return (
                <details key={category} id={`research-category-${store.id}-${category}`} tabIndex={-1} className="group/category scroll-mt-24 rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground" open>
                  <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2 rounded-md bg-muted px-3 py-3 text-sm font-semibold leading-relaxed text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground [&::-webkit-details-marker]:hidden">
                    <ChevronDown aria-hidden className="size-4 shrink-0 -rotate-90 text-muted-foreground group-open/category:rotate-0" />
                    <span className="min-w-0 flex-1">{CATEGORY_LABELS[category]}</span>
                    <span className="text-xs font-normal text-muted-foreground tabular-nums">{categoryItems.length}項目{!reviewCompleted && ` / 未判断 ${remaining}`}</span>
                  </summary>
                  <div className="space-y-3 py-3">
                    {visibleItems.map((item) => {
                      const lane = laneByKey.get(item.key);
                      return (
                        <ResearchItemCard
                          key={item.key}
                          item={item}
                          label={BASIC_INFO_ITEM_BY_KEY.get(item.key)?.label ?? item.key}
                          anchorId={researchItemAnchorId(item.key)}
                          sourceRegistry={run.source_registry}
                          decision={run.review_decisions[item.key]}
                          current={store.basic_info[item.key]}
                          defaultOpen={!reviewCompleted && (lane === "individual" || lane === "choose")}
                          busy={busy || completing}
                          pendingDecision={pendingDecisionForItem(item.key, busy, pendingDecision)}
                          onDecide={(input) => onDecide(item, input)}
                        />
                      );
                    })}
                  </div>
                </details>
              );
            })}

            {nonReviewItems.length > 0 && (
              <details className="border border-border rounded-lg">
                <summary className="cursor-pointer select-none px-4 py-2.5 text-sm font-medium text-foreground bg-muted/30 rounded-lg">
                  調査で値が出なかった項目({nonReviewItems.length}項目)
                </summary>
                <div className="p-4 space-y-3">
                  {nonReviewItems.map((item) => (
                    <NonReviewItemCard
                      key={item.key}
                      item={item}
                      label={BASIC_INFO_ITEM_BY_KEY.get(item.key)?.label ?? item.key}
                    />
                  ))}
                </div>
              </details>
            )}

            {reviewCompleted && (
              <div className="flex justify-end pt-2 border-t border-border">
                <Button type="button" variant="outline" onClick={onRestart} pending={restarting}>
                  再調査する
                </Button>
              </div>
            )}
            {/* 未完了時の完了操作は sticky footer(Card の外)へ置く。53項目・8カテゴリで
                縦に長く、画面下までスクロールしないと完了できなかったため。 */}
            {!reviewCompleted && <div className="h-2" aria-hidden />}
          </Card.Body>
        </Card>
      </div>
      {!reviewCompleted && (
        <ReviewCompletionFooter
          model={footer}
          decidedCount={reviewableItems.length - plan.length}
          undecidedCount={plan.length}
          busy={busy}
          completing={completing}
          onPrimary={onPrimary}
          onCompleteDecidedOnly={onCompleteDecidedOnly}
        />
      )}
    </div>
  );
}

/**
 * レビュー完了操作の sticky footer(feat/ai-research-quality-ux-hardening、Plan §13)。
 *
 * **`<Card>` は `overflow-hidden`(`components/ui/card.tsx`)なので Card の内側では
 * sticky が効かない。** 既存の先例(`stores-table-view.tsx` / `area-search-results.tsx`)
 * と同じく Card の外に置く。クラス列も先例をそのまま踏襲する
 * (`fixed` ではなく `sticky` にすることで、サイドバー折りたたみでも左端がズレない)。
 * 低い画面では 50dvh を上限として領域内をスクロールさせ、完了ボタンへの到達を保つ。
 */
export function ReviewCompletionFooter({
  model,
  decidedCount,
  undecidedCount,
  busy,
  completing,
  onPrimary,
  onCompleteDecidedOnly,
}: {
  model: ReviewFooterModel;
  decidedCount: number;
  undecidedCount: number;
  busy: boolean;
  completing: boolean;
  onPrimary: () => void;
  onCompleteDecidedOnly: () => void;
}) {
  const disabled = busy || completing;
  const breakdown = [model.bulkLine, model.remainingLine]
    .filter((line): line is string => line !== null)
    .join(" ／ ");

  const primaryButton = (
    <Button
      type="button"
      variant="primary"
      size="touch"
      className="w-full @min-[40rem]/review:w-auto"
      onClick={onPrimary}
      pending={completing}
      disabled={disabled}
    >
      <span className="min-w-0 whitespace-normal text-center">{completing ? "処理中…" : model.primary.label}</span>
    </Button>
  );
  const skipButton = model.skipLabel !== null ? (
    <Button
      type="button"
      variant="ghost"
      size="touch"
      className="w-full @min-[40rem]/review:w-auto"
      onClick={onCompleteDecidedOnly}
      disabled={disabled}
    >
      <span className="min-w-0 whitespace-normal text-center">{model.skipLabel}</span>
    </Button>
  ) : null;
  const progressLabel = `判断済み ${decidedCount} ・ 未対応 ${undecidedCount}`;

  return (
    <div
      role="region"
      aria-label="レビュー完了操作"
      className="sticky bottom-0 z-30 max-h-[50dvh] overflow-y-auto rounded-t-lg border border-border bg-card px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-card [@media(max-height:30rem)]:static [@media(max-height:30rem)]:max-h-none"
    >
      <div className="hidden flex-wrap items-center gap-3 @min-[40rem]/review:flex">
        <div className="min-w-0 flex-1 basis-64 space-y-0.5 text-xs leading-relaxed text-muted-foreground" aria-live="polite">
          <span className="block tabular-nums">{progressLabel}</span>
          {breakdown !== "" && <span>{breakdown}</span>}
        </div>
        <div className="ms-auto flex min-w-0 flex-wrap items-center justify-end gap-2">
          {skipButton}
          {primaryButton}
        </div>
      </div>
      <div className="space-y-2 @min-[40rem]/review:hidden">
        {primaryButton}
        <details className="group/completion">
          <summary className="flex min-h-11 cursor-pointer list-none flex-wrap items-center justify-between gap-2 rounded-sm text-xs leading-relaxed text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground [&>*+*]:ml-auto [&::-webkit-details-marker]:hidden">
            <span aria-live="polite" className="tabular-nums">{progressLabel}</span>
            <span className="inline-flex items-center gap-1 font-medium text-foreground">
              内訳・完了方法 <ChevronDown aria-hidden className="size-3.5 group-open/completion:rotate-180" />
            </span>
          </summary>
          <div className="space-y-2 border-t border-border pt-3 text-xs leading-relaxed text-muted-foreground">
            {breakdown !== "" && <p>{breakdown}</p>}
            {skipButton}
          </div>
        </details>
      </div>
    </div>
  );
}
