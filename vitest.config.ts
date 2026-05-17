import path from "node:path";
import { configDefaults, defineConfig } from "vitest/config";

/**
 * Vitest 設定:
 * - `server-only` パッケージを `empty.js` に alias する
 *   (本番ビルドでは Next.js が `react-server` condition で `empty.js` に解決するが、
 *    Vitest 環境では condition 解決が効かないため明示的に向ける)
 * - `@/*` パスエイリアスをプロジェクトルートに合わせる
 * - `.claude/**` を test 対象から除外する
 *   (Claude Code の worktree 機能が `.claude/worktrees/<name>/` に別ブランチの
 *    ファイルツリーを展開するため、デフォルト exclude のままだと他ブランチの
 *    test/source が拾われて誤検知エラーになる。CI では `.claude/` が repo に
 *    含まれないため再現しないが、ローカル DX 保護のため明示除外する)
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
    exclude: [...configDefaults.exclude, ".claude/**"],
  },
});
