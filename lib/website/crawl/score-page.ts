/**
 * homepage 上で実際に観測したリンクの決定的スコアリング(Plan v1.1 §7.5）。
 * path 文字列から盲目的に推測 fetch はしない — ここで扱う候補は常に、
 * 呼び出し側が homepage の `<a href>` から実際に収集したものである。
 *
 * `CATEGORY_KEYWORDS` / `matchesCategory` は menu/reservation link の判定
 * (`lib/website/parse/extract-page.ts`）とスコアリングの両方で共有する
 * 単一の語彙定義である。
 */

export const CATEGORY_KEYWORDS = {
  menu: ["menu", "food", "drink", "course", "lunch", "dinner", "メニュー", "お品書き", "コース"],
  reserve: ["reserve", "reservation", "booking", "yoyaku", "予約"],
  access: ["access", "map", "location", "アクセス", "地図"],
  about: ["about", "concept", "shop", "store", "company", "こだわり", "店舗情報", "当店"],
} as const;

export type LinkCategory = keyof typeof CATEGORY_KEYWORDS;
export const LINK_CATEGORIES = Object.keys(CATEGORY_KEYWORDS) as readonly LinkCategory[];

/** カテゴリ優先度(降順。menu が最優先）。tiebreak(§7.5 の 2 番目の基準）で使う。 */
const CATEGORY_PRIORITY: Record<LinkCategory, number> = { menu: 3, reserve: 2, access: 1, about: 0 };

function safeParseUrl(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

function categoryHits(
  pathLower: string,
  anchorLower: string,
  category: LinkCategory,
): { pathHit: boolean; anchorHit: boolean } {
  const keywords = CATEGORY_KEYWORDS[category];
  return {
    pathHit: keywords.some((kw) => pathLower.includes(kw.toLowerCase())),
    anchorHit: keywords.some((kw) => anchorLower.includes(kw.toLowerCase())),
  };
}

/** URL の path または anchor text が指定カテゴリのキーワードに一致するか(boolean、順位付けなし）。 */
export function matchesCategory(url: string, anchorText: string, category: LinkCategory): boolean {
  const parsed = safeParseUrl(url);
  const pathLower = (parsed?.pathname ?? "").toLowerCase();
  const anchorLower = anchorText.toLowerCase();
  const { pathHit, anchorHit } = categoryHits(pathLower, anchorLower, category);
  return pathHit || anchorHit;
}

export interface ScoredLink {
  url: string;
  score: number;
  category: LinkCategory | null;
  segmentCount: number;
}

/**
 * path 一致 +10 / anchor text 一致 +4(カテゴリ横断は最大スコアのカテゴリを採用）。
 * 不正な URL は score 0 / category null / segmentCount 0 として扱う(除外は呼び出し側の責務）。
 */
export function scorePage(url: string, anchorText: string): ScoredLink {
  const parsed = safeParseUrl(url);
  if (!parsed) {
    return { url, score: 0, category: null, segmentCount: 0 };
  }
  const pathLower = parsed.pathname.toLowerCase();
  const anchorLower = anchorText.toLowerCase();

  let bestCategory: LinkCategory | null = null;
  let bestScore = 0;
  for (const category of LINK_CATEGORIES) {
    const { pathHit, anchorHit } = categoryHits(pathLower, anchorLower, category);
    const score = (pathHit ? 10 : 0) + (anchorHit ? 4 : 0);
    if (score > bestScore) {
      bestScore = score;
      bestCategory = category;
    }
  }

  const segmentCount = parsed.pathname.split("/").filter((s) => s !== "").length;
  return { url, score: bestScore, category: bestCategory, segmentCount };
}

/**
 * 決定的な tiebreak: score 降順 → カテゴリ優先度降順(menu > reserve > access > about > なし）
 * → path segment 数昇順(浅い方を優先） → URL 文字列昇順。
 */
export function compareScoredLinks(a: ScoredLink, b: ScoredLink): number {
  if (a.score !== b.score) return b.score - a.score;
  const pa = a.category ? CATEGORY_PRIORITY[a.category] : -1;
  const pb = b.category ? CATEGORY_PRIORITY[b.category] : -1;
  if (pa !== pb) return pb - pa;
  if (a.segmentCount !== b.segmentCount) return a.segmentCount - b.segmentCount;
  if (a.url < b.url) return -1;
  if (a.url > b.url) return 1;
  return 0;
}

const MAX_SUBPAGES = 4;
const MAX_PER_CATEGORY = 2;

/**
 * 上位 `MAX_SUBPAGES` 件を選ぶ。同一カテゴリは最大 `MAX_PER_CATEGORY` 件の soft cap
 * を適用し、埋まらなかった枠は他カテゴリから決定的順序(sorted 順）で backfill する。
 * 入力の順序に依らず、内容が同じであれば常に同一の結果を返す。
 */
export function selectSubpages(candidates: readonly ScoredLink[]): ScoredLink[] {
  const sorted = [...candidates].sort(compareScoredLinks);
  const perCategory = new Map<string, number>();
  const admitted: ScoredLink[] = [];
  const deferred: ScoredLink[] = [];

  for (const c of sorted) {
    if (admitted.length >= MAX_SUBPAGES) break;
    const key = c.category ?? "__none__";
    const count = perCategory.get(key) ?? 0;
    if (count < MAX_PER_CATEGORY) {
      admitted.push(c);
      perCategory.set(key, count + 1);
    } else {
      deferred.push(c);
    }
  }
  for (const c of deferred) {
    if (admitted.length >= MAX_SUBPAGES) break;
    admitted.push(c);
  }
  return admitted;
}
