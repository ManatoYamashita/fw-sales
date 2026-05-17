import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
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
