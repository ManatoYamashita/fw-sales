import type { Metadata, Viewport } from "next";
import { Inter, Noto_Sans_JP } from "next/font/google";
import { Toaster } from "@/components/ui/toaster";
import { ThemeProvider } from "@/components/theme/theme-provider";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

const notoSansJP = Noto_Sans_JP({
  variable: "--font-noto-jp",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

const APP_NAME = "Firstweb Lead OS";
const APP_DESCRIPTION =
  "飲食店向け WEB 集客の営業活動 (店舗調査・商談・引き継ぎ・KPI) を一元管理する社内向けリードマネジメントシステム。";

/**
 * metadataBase 用の絶対 URL を解決する。OGP / Twitter Card の画像 URL や
 * `og:url` の絶対化に使われるため、本番では必ず正しいスキーム付き URL が
 * 返る必要がある。
 *
 * 解決優先度:
 *   1. `NEXT_PUBLIC_APP_URL` (非空文字列のみ採用)
 *   2. Vercel Production: `VERCEL_PROJECT_PRODUCTION_URL` (alias domain)
 *   3. Vercel Preview / Dev: `VERCEL_URL` (deployment 固有 URL)
 *   4. ローカルフォールバック (`http://localhost:3000`)
 *
 * 注意: `??` ではなく `||` 系の判定にしている理由は、Vercel に値が空文字列で
 * 登録されている事故ケースを吸収するため (`new URL("")` は TypeError)。
 */
function resolveAppUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (explicit) return explicit;

  const prodAlias = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (process.env.VERCEL_ENV === "production" && prodAlias) {
    return `https://${prodAlias}`;
  }

  const vercelUrl = process.env.VERCEL_URL?.trim();
  if (vercelUrl) return `https://${vercelUrl}`;

  return "http://localhost:3000";
}

const APP_URL = resolveAppUrl();

export const metadata: Metadata = {
  metadataBase: new URL(APP_URL),
  title: {
    default: APP_NAME,
    template: `%s | ${APP_NAME}`,
  },
  description: APP_DESCRIPTION,
  applicationName: APP_NAME,
  generator: "Next.js",
  referrer: "strict-origin-when-cross-origin",
  formatDetection: {
    email: false,
    address: false,
    telephone: false,
  },
  icons: {
    icon: [
      { url: "/icon.webp", type: "image/webp", sizes: "500x500" },
      { url: "/icon.png", type: "image/png", sizes: "500x500" },
    ],
    shortcut: "/favicon.ico",
    apple: [{ url: "/icon.png", sizes: "180x180", type: "image/png" }],
  },
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: APP_NAME,
    statusBarStyle: "default",
  },
  openGraph: {
    type: "website",
    siteName: APP_NAME,
    title: APP_NAME,
    description: APP_DESCRIPTION,
    url: "/",
    locale: "ja_JP",
    // 1200x630 (1.91:1) は Open Graph / Twitter Card 双方の推奨サイズ。
    // PNG を先頭に置くのは LINE / 一部の Facebook 経路が WebP を未対応のため
    // のフォールバック。クローラーは先頭から対応形式を採用する。
    images: [
      {
        url: "/ogp.png",
        width: 1200,
        height: 630,
        alt: `${APP_NAME} — 飲食店向け WEB 集客リード OS`,
        type: "image/png",
      },
      {
        url: "/ogp.webp",
        width: 1200,
        height: 630,
        alt: `${APP_NAME} — 飲食店向け WEB 集客リード OS`,
        type: "image/webp",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: APP_NAME,
    description: APP_DESCRIPTION,
    images: ["/ogp.png"],
  },
  // 社内ツール: 検索エンジンのインデックスを完全拒否する。
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: {
      index: false,
      follow: false,
      noimageindex: true,
      "max-snippet": -1,
      "max-image-preview": "none",
      "max-video-preview": -1,
    },
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f1f5f9" },
    { media: "(prefers-color-scheme: dark)", color: "#020617" },
  ],
  colorScheme: "light dark",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="ja"
      className={`${inter.variable} ${notoSansJP.variable}`}
      suppressHydrationWarning
    >
      <body className="min-h-full overflow-x-clip">
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          {children}
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
