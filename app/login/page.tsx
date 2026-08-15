/**
 * サインイン画面 (auth-and-notifications spec, Issue #16)
 *
 * 未認証ユーザーが proxy からリダイレクトされて到達する画面。
 * Google OAuth サインインボタンと、認証エラー時のメッセージ表示のみを担う。
 *
 * - `redirect` クエリ: サインイン後に復帰するパス。OAuth フロー完了後に
 *   `/auth/callback` 経由で当該パスへ戻る (Req 1.3)
 * - `error` クエリ: OAuth コールバック失敗時に `/login?error=xxx` に戻されたケース (Req 1.4)
 *
 * 関連: design.md §「app/login」, requirements.md §1.2, §1.4, §1.7
 */

import { Suspense, type ReactNode } from "react";
import Link from "next/link";
import { GoogleSignInButton } from "./_components/google-signin-button";

type LoginSearchParams = Promise<{
  readonly redirect?: string;
  readonly error?: string;
}>;

interface LoginPageProps {
  readonly searchParams: LoginSearchParams;
}

function deriveErrorMessage(code: string | undefined): string | null {
  if (!code) return null;
  switch (code) {
    case "oauth_failed":
      return "Google でのサインインに失敗しました。もう一度お試しください。";
    case "oauth_cancelled":
      return "サインインがキャンセルされました。";
    case "callback_invalid":
      return "認証コールバックが無効でした。リンクを開き直してお試しください。";
    default:
      return "認証中にエラーが発生しました。時間を置いて再試行してください。";
  }
}

function ErrorBanner({ children }: { children: ReactNode }) {
  return (
    <div
      role="alert"
      className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
    >
      {children}
    </div>
  );
}

// searchParams 依存部分は <Suspense> 境界内の async 子コンポーネントに分離する
// (Next.js 16 / cacheComponents: page 関数本体で Promise を await すると
//  ページ全体がブロックされ、Suspense 境界の内側で動的データにアクセスする必要があるため)
// Issue #26: 既定遷移先は /dashboard ではなく /stores (現時点で /dashboard は無効化済)
async function LoginActions({ searchParams }: { searchParams: LoginSearchParams }) {
  const { redirect, error } = await searchParams;
  const errorMessage = deriveErrorMessage(error);
  const redirectTo =
    redirect && redirect.startsWith("/") ? redirect : "/stores";
  return (
    <>
      {errorMessage ? <ErrorBanner>{errorMessage}</ErrorBanner> : null}
      <GoogleSignInButton redirectTo={redirectTo} />
    </>
  );
}

function LoginActionsFallback() {
  return (
    <div className="space-y-2" aria-hidden>
      <div className="h-11 w-full animate-pulse rounded-md bg-muted/40" />
    </div>
  );
}

export default function LoginPage({ searchParams }: LoginPageProps) {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-4 py-10 text-foreground">
      <div className="w-full max-w-sm space-y-6">
        <div className="space-y-2 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">
            FirstWeb - Reserch AI for Sales
          </h1>
          <p className="text-sm text-muted-foreground">
            営業チーム専用ツールです。Google アカウントでサインインしてください。
          </p>
        </div>

        <Suspense fallback={<LoginActionsFallback />}>
          <LoginActions searchParams={searchParams} />
        </Suspense>

        <p className="text-center text-xs text-muted-foreground">
          サインインにより、
          <Link
            href="/terms"
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-foreground underline underline-offset-2 transition-colors hover:text-primary"
          >
            利用規約
          </Link>
          と
          <Link
            href="/privacy"
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-foreground underline underline-offset-2 transition-colors hover:text-primary"
          >
            プライバシーポリシー
          </Link>
          に同意したものとみなされます。
        </p>
      </div>
    </main>
  );
}
