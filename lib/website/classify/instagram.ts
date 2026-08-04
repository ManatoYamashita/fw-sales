/**
 * Instagram derived helper(Plan v1.1 §10、契約 §B.2）。
 *
 * canonical fact は `website_instagram_links`(url_list）の 1 つのみ。ここに定義する
 * 3 つの helper は決定的に `website_instagram_links` から導出できるため、
 * DigitalSignal を追加生成しない(builder は Phase 2 が実装する）。
 *
 * followers / posts / last_post / reach 等は実装しない(Meta API 無しに推測しない）。
 */

const NON_USERNAME_SEGMENTS = new Set([
  "p",
  "reel",
  "reels",
  "explore",
  "stories",
  "tv",
  "accounts",
  "direct",
  "challenge",
  "about",
  "developer",
  "legal",
  "privacy",
]);

export function hasInstagramReference(links: readonly string[]): boolean {
  return links.length > 0;
}

export function primaryInstagramUrl(links: readonly string[]): string | null {
  return links[0] ?? null;
}

/** path 第 1 セグメントを username とみなす。予約語(投稿/リール等のパス)は除外する。 */
export function instagramUsernameFromUrl(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const segments = parsed.pathname.split("/").filter((s) => s !== "");
  const first = segments[0];
  if (!first) return null;
  if (NON_USERNAME_SEGMENTS.has(first.toLowerCase())) return null;
  return first;
}
