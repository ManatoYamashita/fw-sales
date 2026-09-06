/**
 * (legal) Route Group の共通レイアウト。
 *
 * プライバシーポリシー / 利用規約など、未認証ユーザーがログイン画面から到達
 * する法的ページを束ねる。認証必須の `(main)` とは隔離された領域で、
 * `proxy.ts` の matcher でも `/privacy` / `/terms` は保護対象から除外して
 * いる (未認証でも閲覧できる必要があるため)。
 *
 * レイアウトは Server Component。共有 UI (戻るリンク・フッター) を提供する。
 */

import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export default function LegalLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <div className="min-h-dvh bg-background text-foreground">
      <div className="mx-auto w-full max-w-3xl px-4 py-10 sm:py-16">
        <header className="mb-8">
          <Link
            href="/login"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden />
            ログインへ戻る
          </Link>
        </header>

        <main>{children}</main>

        <footer className="mt-16 border-t border-border pt-6 text-xs text-muted-foreground">
          <div className="flex flex-wrap items-center justify-between gap-3 [&>*+*]:ml-auto">
            <span>FirstWeb - Reserch AI for Sales</span>
            <nav className="flex items-center gap-4">
              <Link
                href="/terms"
                className="transition-colors hover:text-foreground"
              >
                利用規約
              </Link>
              <Link
                href="/privacy"
                className="transition-colors hover:text-foreground"
              >
                プライバシーポリシー
              </Link>
              <Link
                href="/login"
                className="transition-colors hover:text-foreground"
              >
                ログイン
              </Link>
            </nav>
          </div>
        </footer>
      </div>
    </div>
  );
}
