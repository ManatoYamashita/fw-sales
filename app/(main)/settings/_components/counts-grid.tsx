import { StatSkeleton } from "@/components/ui/stat";

/**
 * 設定画面の件数カードのグリッド (#265)。**列ラダーと枚数の唯一の出所。**
 *
 * ## なぜ定数に切り出すのか
 *
 * 参照点が 3 つある — `page.tsx` の本体 (`CountsGrid`)、その Suspense fallback、
 * そして `loading.tsx`。逐語コピーだと 1 つ直し忘れた瞬間に、データ到着時と
 * ナビゲーション時でレイアウトが飛ぶ。実際に直前まで
 * 「本体は 144px / fallback は 88px」で **56px の跳ね**が出ていた。
 *
 * ## 4 列化が `lg:` である理由
 *
 * 768px はサイドバーが出現してコンテンツが 528px へ落ちる帯で、ここで 4 列にすると
 * 1 列 111px しか無くラベルが折り返してカード高が伸びる (`/dashboard` が #224 で
 * 踏んだ md 境界の崖と同型)。1024px なら 175px 取れる。
 * 375px の 2 列 (166px) はラベルの溢れも切り詰めも無いので、base は 2 列のまま。
 */
export const COUNTS_GRID_CLASS = "grid grid-cols-2 lg:grid-cols-4 gap-3";

/** 件数カードの枚数。`page.tsx` の `Stat` の数と一致していること。 */
export const COUNTS_GRID_CELLS = 4;

/**
 * 件数カードの placeholder。高さは `StatSkeleton` が `Stat` と同じ構造で作るので、
 * ここでも `page.tsx` でも数値を持たない。
 */
export function CountsGridSkeleton() {
  return (
    <div className={COUNTS_GRID_CLASS}>
      {Array.from({ length: COUNTS_GRID_CELLS }).map((_, i) => (
        <StatSkeleton key={i} />
      ))}
    </div>
  );
}
