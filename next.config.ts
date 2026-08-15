import type { NextConfig } from "next";
import { withWorkflow } from "workflow/next";

// 意図的に設定していないオプション:
//
// `experimental.viewTransition` — React の <ViewTransition> は Next.js 16.3 以降、
// 設定不要で動作する (App Router が vendored React canary を使うため)。16.2 まで必要
// だったこのフラグは 16.3 で config スキーマから削除されており、指定すると型エラーに
// なる。利用箇所は app/(main)/stores/new と app/globals.css。
// なお 16.2.4 でフラグが有効だった時点でも <Link> / router.push 経路では
// document.startViewTransition は発火せず (実測 0 回)、発火するのは setState 経路のみ。

const nextConfig: NextConfig = {
  cacheComponents: true,
  // `'use cache'` 共通プロファイル。無効化は全 mutation の revalidateTag(タグ駆動)が
  // 担うため、TTL は保険として長めに設定する。stale 5m / revalidate 6h / expire 7d。
  //
  // 閾値は node_modules/next/dist/server/use-cache/constants.js に定義される
  // (16.2 の DYNAMIC_EXPIRE は 16.3 で MIN_PRERENDERABLE_EXPIRE へ同値リネーム):
  //   expire < MIN_PRERENDERABLE_EXPIRE(300s) … prerender 対象外 = dynamic hole 化
  //   stale  < MIN_SHELL_STALE(300s)          … 静的シェル対象外 = post-shell へ遅延
  //   stale  < MIN_PREFETCHABLE_STALE(30s)    … prerender からも完全除外
  cacheLife: {
    // stale は MIN_SHELL_STALE と同値。比較が strict `<` のため 300 は境界を通過し
    // 静的シェルに載るが、1 秒でも下げると当該 'use cache' が全て静的シェルから
    // 脱落し、static PPR (#115) が崩れる。値を変える際は必ず build 後の
    // ルート一覧 (`ƒ` が増えていないか) を確認すること。
    longBackstop: { stale: 300, revalidate: 21600, expire: 604800 },
    // build 時 prerender 充填を避けたい重いクエリ用の保険プロファイル。
    // expire < MIN_PRERENDERABLE_EXPIRE(300s) で当該 'use cache' は prerender 対象から
    // 除外され dynamic-hole 化する = build 時に prod DB へ充填しに行かず、リクエスト時
    // 充填 + 短期 runtime cache で運用する。無効化は全 mutation の revalidateTag が担う。
    dynamicHole: { stale: 60, revalidate: 120, expire: 240 },
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

// AI 店舗調査(Issue #158, Plan v3.2 §16)の長時間実行基盤として Vercel Workflow を採用。
// `withWorkflow` は "use workflow" / "use step" ディレクティブを含むファイルをコンパイルする。
// 既存ルートへの影響はなく、当該ディレクティブを使わないコードには何も作用しない。
export default withWorkflow(nextConfig);
