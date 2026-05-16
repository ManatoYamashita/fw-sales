import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
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
};

export default nextConfig;
