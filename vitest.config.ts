import path from "node:path";
import { defineConfig } from "vitest/config";

/**
 * Vitest 設定:
 * - `server-only` パッケージを `empty.js` に alias する
 *   (本番ビルドでは Next.js が `react-server` condition で `empty.js` に解決するが、
 *    Vitest 環境では condition 解決が効かないため明示的に向ける)
 * - `@/*` パスエイリアスをプロジェクトルートに合わせる
 */
export default defineConfig({
  resolve: {
    alias: {
      "server-only": path.resolve(__dirname, "node_modules/server-only/empty.js"),
      "@": path.resolve(__dirname, "."),
    },
    conditions: ["react-server", "import", "node", "default"],
  },
});
