"use client";

/**
 * Google サインインボタン (Client Component)
 *
 * `getSupabaseBrowserClient()` を介して `signInWithOAuth({ provider: 'google' })`
 * を起動する。`redirectTo` パラメータでサインイン後の復帰先を `/auth/callback`
 * 経由で伝播する (Req 1.2, 1.3)。
 *
 * 関連: design.md §「app/login」
 */

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

interface Props {
  readonly redirectTo: string;
}

export function GoogleSignInButton({ redirectTo }: Props) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleClick() {
    setError(null);
    startTransition(async () => {
      try {
        const supabase = getSupabaseBrowserClient();
        const callbackUrl = new URL(
          "/auth/callback",
          window.location.origin,
        );
        callbackUrl.searchParams.set("redirect", redirectTo);
        const { error: oauthError } = await supabase.auth.signInWithOAuth({
          provider: "google",
          options: {
            redirectTo: callbackUrl.toString(),
          },
        });
        if (oauthError) {
          setError(oauthError.message);
        }
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : "サインインに失敗しました。",
        );
      }
    });
  }

  return (
    <div className="space-y-2">
      <Button
        type="button"
        variant="outline"
        size="lg"
        className="w-full"
        onClick={handleClick}
        disabled={isPending}
      >
        <GoogleIcon />
        <span>{isPending ? "サインイン中..." : "Google でサインイン"}</span>
      </Button>
      {error ? (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      className="h-4 w-4"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        fill="#4285F4"
        d="M23.49 12.27c0-.79-.07-1.54-.19-2.27H12v4.51h6.44c-.28 1.48-1.13 2.73-2.4 3.58v2.96h3.88c2.27-2.09 3.57-5.17 3.57-8.78z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.95-1.08 7.93-2.92l-3.88-2.96c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.76-2.1-6.7-4.94H1.27v3.06C3.25 21.3 7.31 24 12 24z"
      />
      <path
        fill="#FBBC05"
        d="M5.3 14.34A7.21 7.21 0 0 1 4.93 12c0-.81.13-1.59.36-2.34V6.6H1.27A11.99 11.99 0 0 0 0 12c0 1.94.46 3.78 1.27 5.4l4.03-3.06z"
      />
      <path
        fill="#EA4335"
        d="M12 4.74c1.76 0 3.34.61 4.59 1.79l3.43-3.43C17.95 1.18 15.24 0 12 0 7.31 0 3.25 2.7 1.27 6.6l4.03 3.06C6.24 6.83 8.88 4.74 12 4.74z"
      />
    </svg>
  );
}
