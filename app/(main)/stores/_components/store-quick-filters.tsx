"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import {
  ASSIGNEE_SCOPES,
  ASSIGNEE_SCOPE_LABELS,
  AXIS_LABELS,
  TIMING_SCOPES,
  TIMING_SCOPE_LABELS,
  buildAssigneeHref,
  buildTimingHref,
  readQuickFilterState,
} from "./store-quick-filter-params";

/**
 * 店舗一覧のクイックフィルタ (2 軸)。
 *
 * 「担当店舗」と「次回アクション」は別の軸なので、独立した 2 つの `<nav>` として
 * 表現する。片方を押しても他方の param は保持され、`?sales=me&next=overdue`
 * (自分が担当かつ期限超過) が 2 クリックで作れる。URL 構築規則は
 * `store-quick-filters.ts` (純粋関数) が単一の真実。
 *
 * ## a11y
 * - チップは `<button>` ではなく `<Link>`。URL が状態のすべてなので、
 *   キーボード / Cmd・Ctrl+click / middle click / 新規タブ / リンクのコピーが
 *   そのまま効く。
 * - **`aria-pressed` は使わない**。`aria-pressed` は toggle button 用のプロパティで、
 *   link ロールには適用されない (支援技術に無視されるか誤読される)。
 *   選択状態は link に適した `aria-current` で表す。
 * - 各グループは `<nav aria-label>` で「何を絞り込む一覧か」を明示する。
 *   視覚ラベル (担当 / 対応) は同じ情報の重複なので `aria-hidden`。
 * - 選択状態を色だけで表さない。`aria-current="true"` に加えて Check アイコンを
 *   表示し、コントラストに依存せず判別できるようにする。
 *
 * ナビゲーションは `replace` + `scroll={false}`。ページ内の既存フィルタ操作
 * (`ProgressFilterBar` の `router.replace` / `SortableHeader` の `<Link replace>`)
 * と同じ規約に揃え、同一ページ上に 2 種類の履歴挙動を混在させない。
 */
export function StoreQuickFilters() {
  const params = useSearchParams();
  const { assignee, timing } = readQuickFilterState(params);

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <nav
        aria-label={`${AXIS_LABELS.assignee}で絞り込み`}
        className="flex items-center gap-1.5 flex-wrap"
      >
        <GroupLabel>{AXIS_LABELS.assignee}</GroupLabel>
        {ASSIGNEE_SCOPES.map((scope) => (
          <QuickFilterChip
            key={scope}
            href={buildAssigneeHref(params, scope)}
            active={assignee === scope}
          >
            {ASSIGNEE_SCOPE_LABELS[scope]}
          </QuickFilterChip>
        ))}
      </nav>

      <span
        aria-hidden
        className="hidden sm:block h-5 w-px self-center bg-border"
      />

      <nav
        aria-label={`${AXIS_LABELS.timing}で絞り込み`}
        className="flex items-center gap-1.5 flex-wrap"
      >
        <GroupLabel>{AXIS_LABELS.timing}</GroupLabel>
        {TIMING_SCOPES.map((scope) => {
          const active = timing === scope;
          return (
            <QuickFilterChip
              key={scope}
              href={buildTimingHref(params, scope)}
              active={active}
              // 選択中のチップは押すと解除される。マウス利用者への予告。
              // 支援技術には aria-current が状態を伝えるため title は補助に留める。
              title={active ? "クリックで解除" : undefined}
            >
              {TIMING_SCOPE_LABELS[scope]}
            </QuickFilterChip>
          );
        })}
      </nav>
    </div>
  );
}

function GroupLabel({ children }: { children: React.ReactNode }) {
  return (
    <span
      aria-hidden
      className="text-[11px] font-semibold tracking-[0.08em] text-muted-foreground pr-0.5"
    >
      {children}
    </span>
  );
}

/**
 * クイックフィルタチップの class。テストから直接検証できるよう純関数にしている。
 *
 * ## 視覚的優先度
 * クイックフィルタは主要 CTA ではない。以前は active を `bg-foreground`
 * (ほぼ黒の塗り) にしていたため、「店舗を登録」(主要 CTA) と同じ強さに見えていた。
 * active は `bg-accent` の淡い面 + 強めのボーダー + 太字で表し、
 * 主要 CTA より一段弱く見せる。
 *
 * ## 色だけに依存しない
 * active は Check アイコンと `aria-current` でも判別できる (呼び出し側)。
 * コントラストは light `#0f172a` on `#e2e8f0`、dark `#f1f5f9` on `#334155` で
 * いずれも WCAG AA を大きく上回る。
 *
 * ## 基底ユーティリティを重ねない
 * `cn` は素の clsx (tailwind-merge なし) なので、同じプロパティの基底
 * ユーティリティを 2 つ並べると CSS の記述順で勝敗が決まり、意図と逆になりうる
 * (`progress-filter-bar.tsx` の絞り込みボタンで実際に文字が消えた)。
 * active / inactive は必ず**排他の三項**で書き、色を重ね書きしない。
 */
export function quickFilterChipClassName(active: boolean): string {
  return cn(
    "inline-flex items-center gap-1 h-9 px-3 rounded-full text-sm",
    "border transition-[background-color,color,border-color]",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
    active
      ? "bg-accent text-accent-foreground border-foreground/35 font-semibold"
      : "bg-card text-foreground/80 border-border font-medium hover:bg-accent/60 hover:text-foreground",
  );
}

function QuickFilterChip({
  href,
  active,
  title,
  children,
}: {
  href: string;
  active: boolean;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      replace
      scroll={false}
      prefetch={false}
      aria-current={active ? "true" : undefined}
      title={title}
      className={quickFilterChipClassName(active)}
    >
      {active ? <Check className="h-3.5 w-3.5 shrink-0" aria-hidden /> : null}
      {children}
    </Link>
  );
}

/**
 * クイックフィルタの骨格 fallback。
 *
 * `useSearchParams` を使う Client Component は本番ビルドで Suspense 境界が必須
 * (`node_modules/next/dist/docs/01-app/03-api-reference/04-functions/use-search-params.md`)。
 * `ProgressFilterBarFallback` と同じく実 DOM と同じ flex 構造・同じ高さを写して
 * レイアウトシフトを避け、一瞬で埋まるためスピナーは出さない。
 */
export function StoreQuickFiltersFallback() {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2" aria-hidden>
      <div className="h-9 w-[330px] max-w-full rounded-full bg-muted/40" />
      <span className="hidden sm:block h-5 w-px self-center bg-border" />
      <div className="h-9 w-[250px] max-w-full rounded-full bg-muted/40" />
    </div>
  );
}
