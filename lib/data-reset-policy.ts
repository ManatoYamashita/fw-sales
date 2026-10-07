/**
 * 「シードデータに戻す」「全データを削除」を許可する環境の判定 (#298)。
 *
 * どちらも `handoffs → deals → stores` を全削除する操作で、`requireAdmin` だけでは
 * 本番の管理者 (8 人中 6 人) が 2 クリックで本番を消せてしまう。そこで「環境」でも絞る。
 *
 * ## なぜ `VERCEL_ENV !== "production"` だけでは足りないか
 *
 * `.env.local` の `DATABASE_URL` は本番 Supabase を直接指している。`next dev` は
 * `VERCEL_ENV` を持たないため、「本番以外なら許可」にするとローカル開発から本番 DB を
 * 全削除できてしまう。Preview デプロイも同じ DB を指しうる。
 *
 * そのため **明示的に `ALLOW_DATA_RESET=1` を立てた環境だけ許可する** (fail-closed)。
 * 加えて `VERCEL_ENV=production` ではフラグがあっても拒否する。
 * フラグは使い捨ての DB (E2E 用ローカル PostgreSQL など) を指す環境でだけ立てること。
 */
export const DATA_RESET_FLAG = "ALLOW_DATA_RESET";

type Env = Readonly<Record<string, string | undefined>>;

export function isDataResetAllowed(env: Env = process.env): boolean {
  if (env.VERCEL_ENV === "production") return false;
  return env[DATA_RESET_FLAG] === "1";
}

/** 拒否時に UI へ返す文言。環境変数名などの内部情報は含めない。 */
export const DATA_RESET_DENIED_MESSAGE =
  "この環境ではシードリセット・全データ削除は実行できません";
