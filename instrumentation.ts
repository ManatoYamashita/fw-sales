import { assertEnvironmentIsolation } from "@/lib/environment-isolation.mjs";

// Next.jsのサーバーがリクエストを受ける前にDBとAuthの組合せを検証します。
export function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") assertEnvironmentIsolation();
}
