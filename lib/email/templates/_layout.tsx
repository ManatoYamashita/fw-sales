/**
 * メール共通 HTML レイアウトと renderEmail ヘルパ (auth-and-notifications spec)
 *
 * - 全テンプレートが共有するヘッダー / フッター / 基本タイポグラフィを提供
 * - `renderEmail(<Template />)` で React 要素を HTML 文字列に変換する
 * - メールクライアントの互換性を意識し、CSS は inline 属性 (`style={{}}`) で記述
 *
 * 関連: design.md §「lib/email/templates」, requirements.md §4.4
 */

import "server-only";
import type { ReactElement, ReactNode } from "react";

/**
 * `react-dom/server` を **dynamic import** で読込む。
 *
 * Next.js 16 / Turbopack は App Route の transitive import に `react-dom/server`
 * が含まれるとビルドエラーを発する(ブラウザ流入リスクの静的解析)。
 * メールテンプレートは Cron Route Handler から呼ばれるため、本ヘルパで動的解決し
 * Route の静的 import グラフから `react-dom/server` を切り離す。
 */
type RenderToStaticMarkup = (element: ReactElement) => string;
let _renderToStaticMarkupCache: RenderToStaticMarkup | null = null;
async function loadRenderToStaticMarkup(): Promise<RenderToStaticMarkup> {
  if (_renderToStaticMarkupCache) return _renderToStaticMarkupCache;
  const mod = await import("react-dom/server");
  _renderToStaticMarkupCache = mod.renderToStaticMarkup as RenderToStaticMarkup;
  return _renderToStaticMarkupCache;
}

const COLORS = {
  background: "#f4f4f5",
  card: "#ffffff",
  border: "#e4e4e7",
  text: "#18181b",
  muted: "#71717a",
  accent: "#2563eb",
  warning: "#dc2626",
} as const;

interface EmailLayoutProps {
  readonly heading: string;
  readonly preheader?: string;
  readonly children: ReactNode;
}

export function EmailLayout({
  heading,
  preheader,
  children,
}: EmailLayoutProps) {
  return (
    <html lang="ja">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{heading}</title>
      </head>
      <body
        style={{
          margin: 0,
          padding: "24px 12px",
          backgroundColor: COLORS.background,
          fontFamily:
            "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Hiragino Sans', 'Noto Sans JP', sans-serif",
          color: COLORS.text,
          lineHeight: 1.6,
        }}
      >
        {preheader ? (
          <span
            style={{
              display: "none",
              maxHeight: 0,
              overflow: "hidden",
              opacity: 0,
            }}
          >
            {preheader}
          </span>
        ) : null}
        <table
          role="presentation"
          width="100%"
          cellPadding={0}
          cellSpacing={0}
          style={{
            maxWidth: 560,
            margin: "0 auto",
            backgroundColor: COLORS.card,
            border: `1px solid ${COLORS.border}`,
            borderRadius: 8,
          }}
        >
          <tbody>
            <tr>
              <td style={{ padding: "20px 24px 0", color: COLORS.muted, fontSize: 12 }}>
                Firstweb Lead OS
              </td>
            </tr>
            <tr>
              <td style={{ padding: "8px 24px 0", fontSize: 18, fontWeight: 600 }}>
                {heading}
              </td>
            </tr>
            <tr>
              <td style={{ padding: "16px 24px 24px", fontSize: 14 }}>{children}</td>
            </tr>
            <tr>
              <td
                style={{
                  padding: "12px 24px 16px",
                  borderTop: `1px solid ${COLORS.border}`,
                  color: COLORS.muted,
                  fontSize: 12,
                }}
              >
                このメールは Firstweb Lead OS から自動配信されました。
                本メールへの返信ではサポートを受けられません。
              </td>
            </tr>
          </tbody>
        </table>
      </body>
    </html>
  );
}

/**
 * 共通色トークン (テンプレート間で再利用)。
 */
export const EMAIL_COLORS = COLORS;

/**
 * メールテンプレート (React Element) を HTML 文字列に変換する。
 * `<!doctype html>` を先頭に付与し、メールクライアントでの DOCTYPE 解釈を安定化させる。
 *
 * 注: dynamic import 化に伴い **async** 関数に変更。callers (build*Email) も
 * Promise<EmailMessage> を返すよう連動更新済 (Phase 12 ビルド修正)。
 */
export async function renderEmail(element: ReactElement): Promise<string> {
  const renderToStaticMarkup = await loadRenderToStaticMarkup();
  return `<!doctype html>${renderToStaticMarkup(element)}`;
}
