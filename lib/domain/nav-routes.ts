/**
 * disabled ルートのプレフィクス定義 (proxy.ts / nav.ts 共有の単一の真実)
 *
 * `proxy.ts` (Node.js runtime) と `lib/domain/nav.ts` (React コンポーネント経路) の
 * 双方から参照される。`nav.ts` は `lucide-react` を import しているため、
 * proxy が nav.ts を直接参照するとアイコンライブラリ一式を proxy バンドルに
 * 引き込むことになる。それを避けるため、ルート定義だけをこのモジュールに切り出し、
 * **依存を一切持たない**状態を保つ。ここに import を追加してはいけない。
 *
 * 経緯: 以前は `nav.ts` と `middleware.ts` が同じ配列をそれぞれ定義し、双方の
 * コメントが互いに「相手が単一の真実」と主張する二重管理になっていた
 * (`nav.ts` 側の export は実際にはどこからも参照されていなかった)。
 * `__tests__/nav-routes.test.ts` が `NAV_ITEMS[].disabled` との一致を検証する。
 */

/**
 * 一時的に利用不可にしているメニューの URL プレフィクス。
 * `nav.ts` の `NAV_ITEMS[].disabled` と必ず一対一で対応させ、解除する際は
 * 両者を同時に戻す。
 */
export const DISABLED_ROUTE_PREFIXES: readonly string[] = [
  "/dashboard",
  "/pipeline",
  "/actions",
  // "/deals" は customer-sales-progress-management で解除 (nav.ts と同時に戻した)。
  "/handoffs",
  "/kpi",
];

/** disabled ルートにアクセスした場合のリダイレクト先。 */
export const FALLBACK_ENABLED_ROUTE = "/stores";

/**
 * `pathname` が disabled ルート配下かを判定する。
 * プレフィクス完全一致、または `/` 区切りの子パスのみを対象とし、
 * `/kpi-report` のような別ルートを誤って巻き込まない。
 */
export function isDisabledPath(pathname: string): boolean {
  return DISABLED_ROUTE_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}
