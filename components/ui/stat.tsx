import { type ReactNode } from "react";
import { Skeleton } from "./skeleton";
import { cn } from "@/lib/utils/cn";

type StatTone = "default" | "primary" | "success" | "warning" | "danger";

const toneIconClass: Record<StatTone, string> = {
  default: "text-muted-foreground bg-muted",
  primary: "text-info bg-info-soft",
  success: "text-success bg-success-soft",
  warning: "text-warning bg-warning-soft",
  danger: "text-destructive bg-destructive-soft",
};

export interface StatDelta {
  value: string;
  /** 上向き=正のシグナル(success), 下向き=負のシグナル(destructive) を表示 */
  trend?: "up" | "down" | "flat";
}

export interface StatProps {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  delta?: StatDelta;
  icon?: ReactNode;
  tone?: StatTone;
  className?: string;
}

const TREND_GLYPH: Record<NonNullable<StatDelta["trend"]>, string> = {
  up: "↗",
  down: "↘",
  flat: "→",
};

const TREND_CLASS: Record<NonNullable<StatDelta["trend"]>, string> = {
  up: "bg-success-soft text-success",
  down: "bg-destructive-soft text-destructive",
  flat: "bg-muted text-muted-foreground",
};

/**
 * 箱そのものを決めるクラス (#265)。`Stat` と `StatSkeleton` が**同じ文字列**を使う。
 *
 * 高さは内容で決まり、`h-*` は持たない。placeholder 側で高さを数値で固定すると、
 * ここの `p-5` やアイコンの寸法を変えた瞬間に無言でずれる。実際に settings は 88px、
 * dashboard と `skeleton.tsx` の `StatGridSkeletonShared` は 112px を書いていて、
 * 実体はいずれも 144px だった。
 *
 * **#265 で直したのは settings だけ。** dashboard (`stat-grid.tsx`) と kpi は
 * `nav-routes.ts` で無効化中のルートで、再有効化時に列構成ごと再測定する約束
 * (`docs/architecture/responsive.md` §8) があるため、測れないまま触らない。
 * 再有効化のときは `StatSkeleton` へ寄せること。
 *
 * hover の affordance (影と移動) はここに含めない。レイアウトには効かないが、
 * placeholder が浮き上がる意味は無いので `Stat` 側だけが足す。
 */
export const STAT_BOX_CLASS =
  "relative flex flex-col gap-2 p-5 bg-card text-card-foreground border border-border rounded-lg shadow-card";

export function Stat({
  label,
  value,
  sub,
  delta,
  icon,
  tone = "default",
  className,
}: StatProps) {
  const trend = delta?.trend ?? "flat";
  return (
    <div
      className={cn(
        STAT_BOX_CLASS,
        "transition-[box-shadow,transform] duration-200",
        "hover:shadow-card-hover hover:-translate-y-0.5",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
        {icon ? (
          <span
            className={cn(
              "h-9 w-9 rounded-lg flex items-center justify-center shrink-0",
              "[&>svg]:h-4 [&>svg]:w-4",
              toneIconClass[tone],
            )}
            aria-hidden
          >
            {icon}
          </span>
        ) : null}
      </div>
      <p className="text-3xl font-semibold tabular-nums leading-none text-foreground">
        {value}
      </p>
      <div className="flex items-center gap-2 min-h-5">
        {delta ? (
          <span
            className={cn(
              "inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-xs font-medium tabular-nums",
              TREND_CLASS[trend],
            )}
          >
            <span aria-hidden>{TREND_GLYPH[trend]}</span>
            <span>{delta.value}</span>
          </span>
        ) : null}
        {sub ? (
          <span className="text-xs text-muted-foreground truncate">{sub}</span>
        ) : null}
      </div>
    </div>
  );
}

/**
 * `Stat` の placeholder。**`Stat` と同じ 3 行構造を描き、高さを CSS に決めさせる。**
 *
 * ## なぜ高さを数値で書かないのか
 *
 * `Stat` の 144px は「border 2 + padding 40 + gap 16 + 行1 36 + 行2 30 + 行3 20」の
 * 合計で、行 1 は**アイコン枠 (`h-9` = 36px) がラベル (16px) を上回って支配**している。
 * つまり 144 はアイコンの寸法・パディング・字送りの関数であって、独立した定数ではない。
 * placeholder 側へ数値を写すと、`Stat` を触った人がここを直し忘れる。
 *
 * ## 各行の高さがどこから来るか
 *
 * - 行 1: `h-9` の枠が支配して 36px。ラベルの placeholder (`h-3`) は下回るので効かない
 * - 行 2: `text-3xl` + `leading-none` の行送りに合わせ、placeholder を `h-[1em]` に
 *   する。`1em` は継承した `1.875rem` = 30px を指すので**数値の写経が要らない**
 * - 行 3: `min-h-5` が空でも 20px を確保する。`Stat` 側の delta / sub の行と同じ
 *
 * ## 実装上の制約
 *
 * - `Stat` は行 1・行 2 を `<p>` で包むが、ここは `<div>` にする。`Skeleton` は
 *   `div` を返すので `<p>` の中に置くとブラウザが `<p>` を自動で閉じ、構造が崩れる
 * - アイコン枠に `rounded-lg` を渡さない。`Skeleton` の基底が `rounded-md` を持ち、
 *   `class-conflicts.test.ts` が border-radius の衝突として落とす。角丸 2px の差は
 *   高さに影響しない
 */
export function StatSkeleton() {
  return (
    <div className={STAT_BOX_CLASS} aria-hidden>
      <div className="flex items-start justify-between gap-3">
        <Skeleton className="h-3 w-16" />
        <Skeleton className="h-9 w-9 shrink-0" />
      </div>
      <div className="text-3xl font-semibold leading-none">
        <Skeleton className="h-[1em] w-14" />
      </div>
      <div className="flex items-center gap-2 min-h-5" />
    </div>
  );
}
