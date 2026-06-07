import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  // `'use cache'` 共通プロファイル。無効化は全 mutation の revalidateTag(タグ駆動)が
  // 担うため、TTL は保険として長めに設定する。stale 5m / revalidate 6h / expire 7d。
  cacheLife: {
    longBackstop: { stale: 300, revalidate: 21600, expire: 604800 },
    // build 時 prerender 充填を避けたい重いクエリ用の保険プロファイル。
    // expire < DYNAMIC_EXPIRE(300s) で当該 'use cache' は prerender 対象から除外され
    // dynamic-hole 化する = build 時に prod DB へ充填しに行かず、リクエスト時充填 +
    // 短期 runtime cache で運用する。無効化は全 mutation の revalidateTag(タグ駆動)が担う。
    dynamicHole: { stale: 60, revalidate: 120, expire: 240 },
  },
  // React の <ViewTransition> を `<Link>` ナビゲーションでも動かすためのフラグ。
  // setState ベースの startTransition では不要だが、将来のページ遷移でも使えるように有効化。
  experimental: {
    viewTransition: true,
  },
  // 社内ツール: meta robots に加えて HTTP ヘッダレベルでもインデックスを完全拒否する
  // (画像 / JSON など HTML をパースしないクローラ経路への保険)。
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "X-Robots-Tag",
            value: "noindex, nofollow, noarchive, nosnippet, noimageindex",
          },
        ],
      },
    ];
  },
  // 店舗登録ページ統合に伴う旧ルートのリダイレクト (308 永続)。
  // /stores/search は /stores/new?mode=area にタブ統合されたため転送する。
  async redirects() {
    return [
      {
        source: "/stores/search",
        destination: "/stores/new?mode=area",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
