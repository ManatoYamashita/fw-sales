import path from "node:path";
import { defineConfig } from "vitest/config";

/**
 * 実 PostgreSQL を要求する integration test 専用の Vitest 設定。
 *
 * なぜ別設定にするか:
 * - 既定の `vitest.config.ts` は `**\/*.integration.test.ts` を exclude する。
 *   通常の `pnpm test` (CI では `USE_MOCK_DB=true`) は実 DB へ接続しないため。
 * - テストファイル側で `skipIf` する方式だと、CI から環境変数が外れた場合に
 *   「0 件 skip で緑」という偽の成功になり、回帰テストが黙って無力化される。
 *   設定で分離し、呼ばれたら必ず走る形にすることでそれを防ぐ。
 *   接続先が未設定なら `beforeAll` の assert が明示的に失敗する。
 *
 * `resolve` は `vitest.config.ts` と同じ内容を保つこと (server-only の alias と
 * `@/*` パスエイリアス、react-server condition)。
 *
 * 実行: `pnpm test:integration` (CI job `Audit DB integration`)
 */
export default defineConfig({
  resolve: {
    alias: {
      "server-only": path.resolve(__dirname, "node_modules/server-only/empty.js"),
      "@": path.resolve(__dirname, "."),
    },
    conditions: ["react-server", "import", "node", "default"],
  },
  test: {
    include: ["**/*.integration.test.ts"],
    exclude: ["node_modules/**", "dist/**", ".claude/**", "e2e/**"],
    // 実 DB を共有し、table lock で互いをブロックし合うため直列実行する。
    fileParallelism: false,
  },
});
