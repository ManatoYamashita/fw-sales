"use client";

/**
 * 53項目レビューセクション(Plan v3.2 §5.3)。カテゴリごとの折りたたみ(`<details>`)・
 * 「要確認のみ表示」フィルタ・レビュー完了(Primary/Secondary)を提供する。
 *
 * ## feat/ai-research-quality-ux-hardening での変更(Plan §12 / §13)
 *
 * 実運用の操作モデルは「AIが具体的に調査した値は基本採用。明らかにおかしいものだけ
 * 編集/却下。skipはほぼ使わない」だが、旧UIは逆に「全項目に個別判断を要求し、
 * 残りは『未確認項目をスキップしてレビュー完了』」というモデルだった。しかも
 * 一括操作(`bulkAdoptConfirmedAction`)は `inferred` を対象外にしていたため、
 * それを使っても未判断が必ず残り、**未対応がある間は primary ボタンが画面上に
 * 1つも存在しない**状態になっていた。
 *
 * - Primary CTA を「残りN件を採用して調査完了」へ変更(単一の atomic Server Action)
 * - 採用対象の内訳(確認済み / 推定)を押す前に表示
 * - `conflict` が未判断なら Primary を block(候補選択なしで自動採用しない)
 * - 完了操作を **sticky footer**(`<Card>` の外)へ移動。53項目で縦に長く、
 *   旧レイアウトでは画面下までスクロールしないと完了できなかった
 *
 * ## 完了ブロッカーUX(本変更)
 *
 * 上記で Primary CTA は常時表示されるようになったが、`conflict` が残っている間の
 * 表示が「候補を選択する必要がある項目が1件あります」だけで、**何の項目か・どこに
 * あるか・何をすれば有効になるか**が分からなかった。実機で「残り30件を採用して
 * 調査完了が押せない理由がわからない」状態が発生した。
 *
 * - 未解決 conflict の**項目名**と「あと何件の候補選択で完了できるか」を sticky footer に常時表示
 * - disabled 理由をボタン直下へ常時表示(tooltip 単独にしない)+ `aria-describedby`
 * - ジャンプCTAで「要確認のみ表示」を ON にした上で**実際に対象itemまでスクロール**
 *   (旧「競合N件へ移動」は filter を ON にするだけで移動しなかった)。
 *   ユーザーが手で閉じたカテゴリが対象でも届くよう、祖先の `<details>` を開いてから
 *   スクロールする(`scrollToResearchItem` の JSDoc 参照)
 * - Secondary CTA の補足に競合件数を含め、Primary との違いを明示
 *
 * **server-side invariant は一切変更していない。** `conflict` を候補選択なしで
 * 採用しないルール(`adoptRemainingAndCompleteReviewAction` のガード)も、
 * `summarizeUndecided` の集計意味論もそのまま。変更は UI / ナビゲーション / 文言のみ。
 */

import { useId, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { toast } from "@/components/ui/toast";
import { ResearchItemCard, type DecideInput } from "./research-item-card";
import { NonReviewItemCard } from "./research-nonreview-card";
import {
  adoptRemainingAndCompleteReviewAction,
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
  getUndecidedReviewableItems,
  isReviewableItem,
  summarizeUndecided,
} from "@/lib/domain/research-review";
import { formatDateTime } from "@/lib/utils/date";
import type { Store } from "@/types/store";
import type { ResearchItem, StoreResearchRun } from "@/types/research-run";

const STATUS_COUNT_LABELS: Record<string, string> = {
  confirmed: "確認済み",
  inferred: "推定",
  conflict: "競合",
  not_found: "確認できず",
  hearing_required: "ヒアリング必要",
  external_data_required: "外部データ必要",
};

/* ------------------------------------------------------------------ */
/*  完了ブロッカーの説明とジャンプ(純関数、UIテストから直接検証する)      */
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
 * 「要確認のみ表示」を ON にしても、conflict を含むカテゴリは `isUnresolved` が true を
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
 * 「要確認のみ表示」を ON にした**後**の DOM に対してスクロールする。
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
 * ジャンプCTAの動作: 「要確認のみ表示」を ON にしてから対象itemへ移動する。
 *
 * 旧「競合N件へ移動」は filter を ON にするだけで**実際には移動しなかった**ため、
 * 53項目の途中に埋もれた conflict にユーザーが辿り着けなかった。
 * scroll 実装を差し替え可能な引数にしてあるのは、DOM 無しでも
 * 「filter ON → 対象keyへ移動」という順序と引数を単体テストで固定するため。
 */
export function handleConflictJump(
  key: string,
  setFilterUnresolved: (next: boolean) => void,
  scroll: (key: string) => void = deferScrollToResearchItem,
): void {
  setFilterUnresolved(true);
  scroll(key);
}

/** 未解決 conflict の説明文言一式(件数依存の文言をここに集約する)。 */
export interface ConflictGuidance {
  /** 未解決 conflict の件数。 */
  count: number;
  /** ジャンプ先(先頭の未解決 conflict の item key)。 */
  targetKey: string;
  /**
   * 「あと何**回の候補選択**で完了できるか」。失敗ではなく残作業として提示する。
   * 単位を「候補選択」と明示するのは、同じ footer に出る「未対応 N」「残り M 件」と
   * 誤読されないようにするため(`buildConflictGuidance` の JSDoc 参照)。
   */
  headline: string;
  /** 何が起きていて、何をすれば完了できるか。 */
  detail: string;
  /** ジャンプCTAのラベル。 */
  jumpLabel: string;
}

/**
 * 未解決 conflict から、完了ブロッカーの説明文言を組み立てる。
 *
 * ## 方針(完了ブロッカーUX)
 *
 * - **失敗表現にしない。** 「エラー」「処理できません」ではなく
 *   「あと N 件の候補選択で完了できます」という残作業の提示にする。
 * - **何をすれば有効になるかまで書く。** disabled の理由説明だけでは、
 *   ユーザーは次の操作を発見できない(実機で発生した状態)。
 * - **項目名を出す。** 件数だけでは 53項目のどこを見ればよいか分からない。
 * - **全件は並べない。** 2件以上は「先頭 ほかN件」に畳んで footer の高さを保つ。
 *
 * ## headline で「候補選択」を明示する理由
 *
 * ブロック中の footer には「未対応 31」「残り30件を採用して調査完了」が同時に出る。
 * ここで headline を「調査完了まであと1件」にすると、**残項目数が1件**だと誤読され、
 * 同じパネル内の 31 / 30 と矛盾して見える。実際の意味は「あと1**回の候補選択**」なので、
 * headline 側でその単位を明示する。headline が「候補選択」を担うぶん、detail 側は
 * 「候補を1つ選ぶと」から「候補を選ぶと」へ縮めて重複を減らす。
 *
 * 未解決 conflict が無ければ `null`(= ブロックしていない)。純関数。
 */
export function buildConflictGuidance(
  conflicts: readonly { key: string; label: string }[],
  adoptableCount: number,
): ConflictGuidance | null {
  const first = conflicts[0];
  if (first === undefined) return null;

  const count = conflicts.length;
  const subject = count === 1 ? `「${first.label}」` : `「${first.label}」ほか${count - 1}件`;
  const outcome =
    adoptableCount > 0 ? `残り${adoptableCount}件をまとめて採用できます` : "調査を完了できます";

  return {
    count,
    targetKey: first.key,
    headline: `あと${count}件の候補選択で完了できます`,
    detail: `${subject}の情報源が一致していません。候補を選ぶと、${outcome}。`,
    jumpLabel: count === 1 ? `${first.label}を確認` : `競合${count}件を確認`,
  };
}

/** Secondary CTA(判断済みのみで完了)の補足文言。競合が残っていればその件数も明示する。 */
export function buildSkipRemainingNote(totalUndecided: number, conflictCount: number): string {
  const suffix = conflictCount > 0 ? `（競合${conflictCount}件を含む）` : "";
  return `未対応${totalUndecided}件${suffix}は反映されません`;
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
  const undecided = useMemo(
    () => getUndecidedReviewableItems(items, run.review_decisions),
    [items, run.review_decisions],
  );

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const item of items) counts[item.status] = (counts[item.status] ?? 0) + 1;
    return counts;
  }, [items]);

  const grouped = useMemo(() => {
    const map = new Map<CategoryKey, ResearchItem[]>();
    for (const item of items) {
      const category = BASIC_INFO_ITEM_BY_KEY.get(item.key)?.category ?? "category_1_basic";
      const arr = map.get(category) ?? [];
      arr.push(item);
      map.set(category, arr);
    }
    return map;
  }, [items]);

  const isUnresolved = (item: ResearchItem): boolean => {
    if (item.status === "not_found" || item.status === "conflict") return true;
    if (!isReviewableItem(item)) return false;
    return run.review_decisions[item.key] === undefined;
  };

  const onDecide = (item: ResearchItem, input: DecideInput) => {
    if (reviewCompleted) return;
    startTransition(async () => {
      const res = await recordReviewDecisionAction({
        runId: run.id,
        storeId: store.id,
        itemKey: item.key,
        decision: input.decision,
        selectedCandidateId: input.selectedCandidateId,
        editedValue: input.editedValue,
      });
      if (res.ok) {
        onUpdate({ ...run, review_decisions: res.data.reviewDecisions });
      } else {
        toast.error(res.error);
      }
    });
  };

  /**
   * Primary CTA: 未判断の confirmed / inferred をまとめて採用し、レビューを完了する
   * (feat/ai-research-quality-ux-hardening、Plan §12)。
   *
   * 実運用は「AIが調査した値は基本採用。おかしいものだけ編集/却下」であり、
   * 旧UIの「全項目に個別判断 → 残りをスキップして完了」とは逆だった。
   * conflict が残っている場合はサーバー側で拒否される(候補選択が必須)。
   *
   * 成功レスポンスは server-returned authoritative state をそのまま使う。
   * クライアント側で `nowIso()` を捏造したり decisions を再構築したりしない。
   */
  const onAdoptRemainingAndComplete = () => {
    startCompleting(async () => {
      const res = await adoptRemainingAndCompleteReviewAction({ runId: run.id, storeId: store.id });
      if (res.ok) {
        onUpdate({
          ...run,
          review_decisions: res.data.reviewDecisions,
          review_completed_at: res.data.reviewCompletedAt,
        });
        toast.success(res.message ?? "レビューを完了しました");
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  };

  /** Secondary CTA: 未対応項目を反映せず、判断済みの内容だけで完了する。 */
  const onCompleteDecidedOnly = () => {
    startCompleting(async () => {
      const res = await completeReviewAction({
        runId: run.id,
        storeId: store.id,
        skipRemaining: true,
      });
      if (res.ok) {
        toast.success(res.message ?? "レビューを完了しました");
        // `completeReviewAction` は decisions を返さないため、サーバー側の確定状態は
        // `router.refresh()` の再取得に委ねる(クライアントで値を捏造しない)。
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  };

  /** Primary CTA で何が採用されるかの内訳(押す前に見えるようにする、Plan §12.1.1)。 */
  const undecidedSummary = useMemo(
    () => summarizeUndecided(items, run.review_decisions),
    [items, run.review_decisions],
  );

  /**
   * 未解決 conflict の**実際の項目**(件数だけでなくラベルとジャンプ先key)。
   * `undecided` から導出するため、候補を採用した瞬間に自動で縮み、
   * 最後の1件を解決した時点で `conflictGuidance` が `null` になる
   * (= ブロック表示が消えて Primary が有効になる)。ページreloadは不要。
   */
  const conflictGuidance = useMemo(
    () =>
      buildConflictGuidance(
        undecided
          .filter((item) => item.status === "conflict")
          .map((item) => ({
            key: item.key,
            label: BASIC_INFO_ITEM_BY_KEY.get(item.key)?.label ?? item.key,
          })),
        undecidedSummary.adoptable,
      ),
    [undecided, undecidedSummary.adoptable],
  );

  const onJumpToConflict = (key: string) => {
    handleConflictJump(key, setFilterUnresolved);
  };

  return (
    <>
      <Card>
        <div className="flex flex-col items-start gap-2 px-5 py-4 border-b border-border">
          <div className="flex items-center gap-2 w-full justify-between">
            <h3 className="text-base font-semibold leading-none tracking-tight">
              AI店舗調査結果({formatDateTime(run.started_at)} 実施)
            </h3>
            <Badge tone={reviewCompleted ? "success" : "warning"}>
              {reviewCompleted ? "調査済み" : "要確認"}
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
        <Card.Body className="space-y-4">
          {run.warnings.length > 0 && (
            <div className="space-y-1 rounded-md border border-warning/40 bg-warning/10 p-3">
              {run.warnings.map((warning, i) => (
                <p key={i} className="flex items-start gap-1.5 text-xs text-warning">
                  <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                  <span>{warning}</span>
                </p>
              ))}
            </div>
          )}

          {!reviewCompleted && (
            <p className="text-sm text-muted-foreground">
              {formatReviewProgressLabel(
                items.length,
                reviewableItems.length,
                reviewableItems.length - undecided.length,
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
              要確認のみ表示
            </Button>
            {!reviewCompleted && conflictGuidance !== null && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => onJumpToConflict(conflictGuidance.targetKey)}
              >
                {conflictGuidance.jumpLabel}
              </Button>
            )}
          </div>

          {Array.from(grouped.entries()).map(([category, categoryItems]) => {
            const visibleItems = filterUnresolved ? categoryItems.filter(isUnresolved) : categoryItems;
            if (visibleItems.length === 0) return null;
            return (
              <details key={category} className="border border-border rounded-lg" open>
                <summary className="cursor-pointer select-none px-4 py-2.5 text-sm font-medium text-foreground bg-muted/30 rounded-lg">
                  {CATEGORY_LABELS[category]}({categoryItems.length}項目)
                </summary>
                <div className="p-4 space-y-3">
                  {visibleItems.map((item) => {
                    const label = BASIC_INFO_ITEM_BY_KEY.get(item.key)?.label ?? item.key;
                    return isReviewableItem(item) ? (
                      <ResearchItemCard
                        key={item.key}
                        item={item}
                        label={label}
                        anchorId={researchItemAnchorId(item.key)}
                        sourceRegistry={run.source_registry}
                        decision={run.review_decisions[item.key]}
                        busy={busy || completing}
                        onDecide={(input) => onDecide(item, input)}
                      />
                    ) : (
                      <NonReviewItemCard key={item.key} item={item} label={label} />
                    );
                  })}
                </div>
              </details>
            );
          })}

          {reviewCompleted && (
            <div className="flex justify-end pt-2 border-t border-border">
              <Button type="button" variant="outline" onClick={onRestart} disabled={restarting}>
                再調査する
              </Button>
            </div>
          )}
          {/* 未完了時の完了操作は sticky footer(Card の外)へ移した。53項目・8カテゴリで
              縦に長く、旧レイアウトでは画面下までスクロールしないと完了できなかったため。 */}
          {!reviewCompleted && <div className="h-2" aria-hidden />}
        </Card.Body>
      </Card>
      {!reviewCompleted && (
        <ReviewCompletionFooter
          summary={undecidedSummary}
          conflictGuidance={conflictGuidance}
          decidedCount={reviewableItems.length - undecided.length}
          busy={busy}
          completing={completing}
          onAdoptRemaining={onAdoptRemainingAndComplete}
          onCompleteDecidedOnly={onCompleteDecidedOnly}
          onJumpToConflict={onJumpToConflict}
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
 * と同じく Card の外side に置く。クラス列も先例をそのまま踏襲する
 * (`fixed` ではなく `sticky` にすることで、サイドバー折りたたみでも左端がズレない)。
 */
export function ReviewCompletionFooter({
  summary,
  conflictGuidance,
  decidedCount,
  busy,
  completing,
  onAdoptRemaining,
  onCompleteDecidedOnly,
  onJumpToConflict,
}: {
  summary: ReturnType<typeof summarizeUndecided>;
  conflictGuidance: ConflictGuidance | null;
  decidedCount: number;
  busy: boolean;
  completing: boolean;
  onAdoptRemaining: () => void;
  onCompleteDecidedOnly: () => void;
  onJumpToConflict: (key: string) => void;
}) {
  const blockedByConflict = conflictGuidance !== null;
  const disabled = busy || completing;
  const hintId = useId();

  return (
    <div
      role="region"
      aria-label="レビュー完了操作"
      className="sticky bottom-0 z-30 flex flex-col gap-2 border-t border-border bg-background/80 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur-md"
    >
      {/* 完了ブロッカーの説明。tooltip にはしない(hoverしないと分からない設計は禁止)。
          「あと何をすれば完了できるか」を常時、文章と項目名とジャンプCTAで提示する。 */}
      {conflictGuidance !== null && (
        <div
          role="status"
          aria-live="polite"
          className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-md border border-warning/40 bg-warning/10 px-3 py-2"
        >
          <p className="flex items-start gap-1.5 text-xs text-warning">
            <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" aria-hidden />
            <span>
              <span className="font-medium">{conflictGuidance.headline}</span>
              <span className="block text-foreground">{conflictGuidance.detail}</span>
            </span>
          </p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="ml-auto w-full sm:w-auto"
            onClick={() => onJumpToConflict(conflictGuidance.targetKey)}
          >
            {conflictGuidance.jumpLabel}
          </Button>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-col gap-0.5 text-xs text-muted-foreground" aria-live="polite">
          <span>
            採用済み {decidedCount} ・ 未対応 {summary.total}
            {blockedByConflict ? ` ・ 要選択 ${summary.conflict}` : ""}
          </span>
          {summary.adoptable > 0 && (
            <span>
              残り: 確認済み {summary.confirmed}・推定 {summary.inferred}
            </span>
          )}
        </div>

        <div className="ml-auto flex flex-col items-stretch gap-1 sm:items-end">
          <Button
            type="button"
            variant="primary"
            className="w-full sm:w-auto"
            onClick={onAdoptRemaining}
            disabled={disabled || blockedByConflict}
            aria-describedby={blockedByConflict ? hintId : undefined}
          >
            {completing
              ? "処理中…"
              : summary.adoptable > 0
                ? `残り${summary.adoptable}件を採用して調査完了`
                : "レビュー完了"}
          </Button>
          {/* disabled 理由をボタン直下に常時表示する(tooltip 単独にしない)。
              `aria-describedby` で支援技術にも同じ理由が届く。 */}
          {blockedByConflict && (
            <span id={hintId} className="text-[11px] text-warning sm:text-right">
              競合を解決すると有効になります
            </span>
          )}
          {summary.total > 0 && (
            <>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="w-full sm:w-auto"
                onClick={onCompleteDecidedOnly}
                disabled={disabled}
              >
                判断済みの内容だけで完了
              </Button>
              <span className="text-[11px] text-muted-foreground sm:text-right">
                {buildSkipRemainingNote(summary.total, summary.conflict)}
              </span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
