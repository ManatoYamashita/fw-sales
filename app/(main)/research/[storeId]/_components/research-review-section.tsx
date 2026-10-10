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

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ResearchItemCard, type DecideInput } from "./research-item-card";
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
  formatReviewProgressLabel,
  getReviewableItems,
  isReviewableItem,
  planReviewLanes,
  summarizeReviewPlan,
  type ReviewLane,
  type ReviewPlanSummary,
} from "@/lib/domain/research-review";
import {
  deriveItemTrust,
  ITEM_TRUST_LABELS,
  toUserFacingRunWarning,
} from "@/lib/domain/research-item-notes";
import { formatDateTime } from "@/lib/utils/date";
import type { Store } from "@/types/store";
import type { ResearchItem, StoreResearchRun } from "@/types/research-run";

/**
 * 見出しの件数ラベル。レビュー対象の項目はカードのバッジと同じ `deriveItemTrust` の区分で数え、
 * 「確認済み 17」と数えた項目のカードに「登録済み」「注記あり」と出る食い違いを作らない (#301)。
 */
const STATUS_COUNT_LABELS: Record<string, string> = {
  ...ITEM_TRUST_LABELS,
  not_found: "確認できず",
  hearing_required: "ヒアリング必要",
  external_data_required: "外部データ必要",
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
  if (typeof document === "undefined") return false;
  const el = document.getElementById(researchItemAnchorId(key));
  if (el === null) return false;

  let ancestor: Element | null = el.closest?.("details") ?? null;
  while (ancestor !== null) {
    if ("open" in ancestor) (ancestor as { open: boolean }).open = true;
    ancestor = ancestor.parentElement?.closest?.("details") ?? null;
  }

  el.scrollIntoView?.({ behavior: "smooth", block: "center" });
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
  const items = useMemo(() => run.result ?? [], [run.result]);
  const [filterUnresolved, setFilterUnresolved] = useState(false);
  const [busy, startTransition] = useTransition();
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

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const item of items) {
      const key = deriveItemTrust(item) ?? item.status;
      counts[key] = (counts[key] ?? 0) + 1;
    }
    return counts;
  }, [items]);

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

  const onDecide = (item: ResearchItem, input: DecideInput) => {
    if (reviewCompleted) return;
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
    <>
      <Card>
        {/* 見出しは 2 段組みだが、箱 (padding / 区切り線) は Card.Header を呼ぶ。
            クラスを逐語コピーするとプリミティブの修正が届かなくなる (#270)。
            縦積みは w-full の子 1 枚に閉じ込め、Card.Header 側の行レイアウトは触らない。 */}
        <Card.Header>
          <div className="flex flex-col items-start gap-2 w-full">
            <div className="flex w-full flex-wrap items-center gap-2 [&>*+*]:ml-auto">
              <Card.Title>
                AI店舗調査結果({formatDateTime(run.started_at)} 実施)
              </Card.Title>
              <Badge tone={reviewCompleted ? "success" : "warning"}>
                {reviewCompleted ? "レビュー完了" : "レビュー未完了"}
              </Badge>
            </div>
            <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
              {Object.entries(statusCounts).map(([status, count]) => (
                <span key={status}>
                  {STATUS_COUNT_LABELS[status] ?? status} {count}
                </span>
              ))}
            </div>
          </div>
        </Card.Header>
        <Card.Body className="space-y-4">
          {run.warnings.length > 0 && (
            <div className="space-y-1 rounded-md border border-warning/40 bg-warning/10 p-3">
              {run.warnings.map((warning, i) => (
                <p key={i} className="flex items-start gap-1.5 text-xs text-warning">
                  <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                  <span>{toUserFacingRunWarning(warning)}</span>
                </p>
              ))}
            </div>
          )}

          {!reviewCompleted && (
            <p className="text-sm text-muted-foreground">
              {formatReviewProgressLabel(
                items.length,
                reviewableItems.length,
                reviewableItems.length - plan.length,
              )}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant={filterUnresolved ? "primary" : "outline"}
              onClick={() => setFilterUnresolved((v) => !v)}
            >
              未判断の項目のみ表示
            </Button>
          </div>

          {Array.from(grouped.entries()).map(([category, categoryItems]) => {
            const visibleItems = filterUnresolved ? categoryItems.filter(isUndecided) : categoryItems;
            if (visibleItems.length === 0) return null;
            return (
              <details key={category} className="border border-border rounded-lg" open>
                <summary className="cursor-pointer select-none px-4 py-2.5 text-sm font-medium text-foreground bg-muted/30 rounded-lg">
                  {CATEGORY_LABELS[category]}({categoryItems.length}項目)
                </summary>
                <div className="p-4 space-y-3">
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
    </>
  );
}

/**
 * レビュー完了操作の sticky footer(feat/ai-research-quality-ux-hardening、Plan §13)。
 *
 * **`<Card>` は `overflow-hidden`(`components/ui/card.tsx`)なので Card の内側では
 * sticky が効かない。** 既存の先例(`stores-table-view.tsx` / `area-search-results.tsx`)
 * と同じく Card の外に置く。クラス列も先例をそのまま踏襲する
 * (`fixed` ではなく `sticky` にすることで、サイドバー折りたたみでも左端がズレない)。
 * 低い画面では 70dvh を上限として領域内をスクロールさせ、完了ボタンへの到達を保つ。
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

  return (
    <div
      role="region"
      aria-label="レビュー完了操作"
      className="sticky bottom-0 z-30 flex max-h-[70dvh] flex-col gap-2 overflow-y-auto border-t border-border bg-background/80 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur-md"
    >
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-col gap-0.5 text-xs text-muted-foreground" aria-live="polite">
          {/* 「採用済み」ではなく「判断済み」。採用だけでなく却下・スキップも含む。 */}
          <span>
            判断済み {decidedCount} ・ 未対応 {undecidedCount}
          </span>
          {model.bulkLine !== null && <span>{model.bulkLine}</span>}
          {model.remainingLine !== null && <span>{model.remainingLine}</span>}
        </div>

        <div className="ml-auto flex flex-col items-stretch gap-1 sm:items-end">
          <Button
            type="button"
            variant="primary"
            className="w-full sm:w-auto"
            onClick={onPrimary}
            pending={completing}
            disabled={disabled}
          >
            {completing ? "処理中…" : model.primary.label}
          </Button>
          {model.primary.kind === "bulk" && !model.primary.complete && (
            <span className="text-xs text-muted-foreground sm:text-right">
              上書きになる項目と推定の項目は、1件ずつ確認します
            </span>
          )}
          {model.skipLabel !== null && (
            <>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="w-full sm:w-auto"
                onClick={onCompleteDecidedOnly}
                disabled={disabled}
              >
                {model.skipLabel}
              </Button>
              <span className="text-xs text-muted-foreground sm:text-right">
                未対応の項目は基本情報に反映されません（いまの値のまま）
              </span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
