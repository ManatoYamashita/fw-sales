/**
 * Portal classifier(Plan v1.1 §5.3、レビュー反映で全面改訂）。pure function。
 *
 * 完全一致ドメインのみを持つ。曖昧な `google.*` のようなワイルドカード文字列は
 * 使わない(`google.com.evil.jp` の誤判定を防ぐため）。Google 系ホストが必要なら
 * `PORTAL_DOMAINS.google` に明示的に追記する。
 *
 * これは SSRF 防御ではない(「一次サイトではない」ための機能的フィルタ）。
 */

export const PORTAL_DOMAINS = {
  tabelog: ["tabelog.com"],
  hotpepper: ["hotpepper.jp"],
  gnavi: ["gnavi.co.jp"],
  retty: ["retty.me"],
  tablecheck: ["tablecheck.com"],
  ebica: ["ebica.jp"],
  ikyu: ["ikyu.com"],
  ozmall: ["ozmall.co.jp"],
  google: ["google.com", "google.co.jp", "goo.gl", "maps.app.goo.gl", "reserve.google.com", "business.site"],
  instagram: ["instagram.com"],
  facebook: ["facebook.com", "fb.com", "fb.me"],
  x: ["x.com", "twitter.com"],
  line: ["line.me", "lin.ee"],
} as const satisfies Record<string, readonly string[]>;

export type PortalKind = keyof typeof PORTAL_DOMAINS;

export const PORTAL_KINDS = Object.keys(PORTAL_DOMAINS) as readonly PortalKind[];

/**
 * host が domain 自身、またはその sub-domain(dot boundary を考慮）と一致するかを判定する。
 * `evil-example.com` は `example.com` の first-party とは判定しない
 * (単純な string suffix 一致ではなく、"." 境界を必須とする）。
 */
export function matchesDomain(host: string, domain: string): boolean {
  const h = host.toLowerCase();
  const d = domain.toLowerCase();
  return h === d || h.endsWith("." + d);
}

/** hostname から portal 種別を判定する。非 portal は null。 */
export function classifyPortal(hostname: string): PortalKind | null {
  const host = hostname.toLowerCase();
  for (const kind of PORTAL_KINDS) {
    if (PORTAL_DOMAINS[kind].some((domain) => matchesDomain(host, domain))) {
      return kind;
    }
  }
  return null;
}

export function isPortalHost(hostname: string): boolean {
  return classifyPortal(hostname) !== null;
}
