import { defineConfig } from "drizzle-kit";

/**
 * Drizzle Kit 設定ファイル
 *
 * - schema: スキーマ定義の参照先（後続 Task 2.1 で `lib/db/schema.ts` が作成される予定）。
 *   drizzle-kit は文字列パス指定で解決するため、ここで型エラーは発生しない。
 * - out: マイグレーション SQL の出力先ディレクトリ。
 * - dialect: PostgreSQL 方言を使用。
 * - dbCredentials.url: `process.env.DATABASE_URL` を直接参照する。
 *   `assertEnv` を使うとモジュール評価時に必須化され、drizzle-kit CLI 以外の
 *   コマンド実行（typecheck 等）が阻害される可能性があるため、シンプルな
 *   フォールバック付き参照に留める。drizzle-kit CLI 実行時のみ実効的に評価される。
 */
export default defineConfig({
  schema: "./lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "",
  },
});
