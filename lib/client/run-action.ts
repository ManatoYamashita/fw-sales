"use client";

import { unstable_rethrow } from "next/navigation";
import { toast, type ToastTone } from "@/components/ui/toast";

/**
 * DB を書き換える Server Action をクライアントから呼び、結果を必ずトーストで伝える (#327)。
 *
 * - 成功: `success` (Action が `message` を返したらそちら) を成功トーストで出す
 * - 失敗 (`ok: false`): Action が返した日本語の文をエラートーストで出す
 * - 例外 (通信断・タイムアウト・サーバ側の throw): 共通の文をエラートーストで出し、
 *   `null` を返す。`startTransition` から例外を漏らして画面全体を error.tsx に
 *   差し替えない
 * - `redirect()`: 成功として扱い、成功トーストを出してから投げ直す。Next.js は
 *   リダイレクトを「Action の Promise を redirect エラーで reject する」形で伝え、
 *   それを受けて遷移するため、握りつぶすと遷移しない
 *
 * 呼び出し側は従来どおり `startTransition` の中で使い、戻り値で後続処理
 * (画面の再取得・遷移・入力欄を閉じる等) を分岐する。トーストは呼び出し側で出さない。
 *
 * 呼び出しがこの関数を通っていることは `run-action-coverage.test.ts` が固定する。
 */

/** 例外で結果が返らなかったときの文。原因 (通信・サーバ) を利用者は区別できないため 1 つにする。 */
export const ACTION_EXCEPTION_MESSAGE =
  "処理を完了できませんでした。通信状況を確認して、もう一度お試しください。";

/** Action が空の文を返したときの受け皿。 */
export const ACTION_FAILURE_FALLBACK_MESSAGE =
  "処理を完了できませんでした。もう一度お試しください。";

export type ActionOutcome<T> =
  | { ok: true; data: T; message?: string }
  | { ok: false; error: string };

export interface SuccessToast {
  message: string;
  tone?: Extract<ToastTone, "success" | "warning" | "info">;
}

export type RunActionOptions<T> =
  | {
      /**
       * 成功トーストの文。文字列なら Action の `message` を優先する。
       * 関数なら結果 (`data`) から組み立てる (一括削除の件数など)。
       */
      success: string | ((data: T, message: string | undefined) => string | SuccessToast);
      silentSuccess?: never;
    }
  | {
      /**
       * 成功トーストを出さない。成功が画面の変化だけで十分に伝わり、連続して
       * 操作するため毎回出すと邪魔になる操作に限る (#327 で決定した 2 つ:
       * 調査レビューの項目ごとの採用・不採用、通知の既読化)。失敗と例外は出す。
       */
      silentSuccess: true;
      success?: never;
    };

function isRedirect(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("digest" in error)) {
    return false;
  }
  const digest = (error as { digest: unknown }).digest;
  return typeof digest === "string" && digest.startsWith("NEXT_REDIRECT");
}

function showSuccess<T>(options: RunActionOptions<T>, data: T, message: string | undefined) {
  if (options.silentSuccess) return;
  const resolved =
    typeof options.success === "function"
      ? options.success(data, message)
      : (message ?? options.success);
  const spec: SuccessToast =
    typeof resolved === "string" ? { message: resolved } : resolved;
  toast.show(spec.message, spec.tone ?? "success");
}

export async function runAction<T>(
  action: () => Promise<ActionOutcome<T>>,
  options: RunActionOptions<T>,
): Promise<ActionOutcome<T> | null> {
  let result: ActionOutcome<T>;
  try {
    result = await action();
  } catch (error) {
    if (isRedirect(error)) {
      // redirect する Action は成功時にしか redirect しない (失敗は ok:false を返す)。
      // 結果の data は無いので、関数形の success には渡せず文字列だけを使う。
      if (!options.silentSuccess && typeof options.success === "string") {
        toast.success(options.success);
      }
    }
    unstable_rethrow(error);
    console.error("[runAction] action threw", error);
    toast.error(ACTION_EXCEPTION_MESSAGE);
    return null;
  }

  if (result.ok) {
    showSuccess(options, result.data, result.message);
  } else {
    toast.error(result.error || ACTION_FAILURE_FALLBACK_MESSAGE);
  }
  return result;
}
