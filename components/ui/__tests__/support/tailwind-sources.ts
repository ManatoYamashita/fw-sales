import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { Scanner } from "@tailwindcss/oxide";
import { REPO_ROOT, compileEntry } from "./build-css";

const execFileAsync = promisify(execFile);

/**
 * **本番と同じ走査設定**で Tailwind のソース検出を再現する (#274。#265 の一般化)。
 *
 * ## なぜ実物の走査器を呼ぶのか
 *
 * 生成される CSS は「どのファイルを読んだか」で決まる。`build-css.ts` は候補を
 * 手渡しするので走査を一切通らず、**走査範囲の事故はそこでは絶対に見つからない**。
 * 正規表現で候補を近似する手もあるが、それは Tailwind の規則 (`.gitignore` の尊重、
 * バイナリ除外、候補の切り出し方) を再現できず、「本番とは違うものを測る」ことになる。
 * `docs/architecture/responsive.md` §4.2 の「候補集合は篩であって判定ではない」と
 * 同じ理由で、ここは本番と同一の `@tailwindcss/oxide` を使う。
 *
 * ## 設定の出所
 *
 * 走査範囲は `app/globals.css` の `@source` が唯一の真実で、ここには写経しない。
 * `compile()` の戻り値がそれをそのまま持っているので、それを Scanner へ渡す。
 */
export type ProductionScan = {
  /** 実際に読まれたファイル。リポジトリルートからの相対パス (POSIX 区切り)。 */
  files: string[];
  /** 抽出されたクラス候補。 */
  candidates: string[];
  /**
   * 自動ソース検出が有効か。有効だとリポジトリを丸ごと読むので、
   * `@source` に何を書いてもそこ**以外**からクラスが入ってくる。
   */
  autoDetection: boolean;
  /** `@source` で明示的に許可したディレクトリ。リポジトリルートからの相対パス。 */
  declaredBases: string[];
};

const toRelative = (absolute: string) =>
  path.relative(REPO_ROOT, absolute).split(path.sep).join("/");

export async function scanProductionSources(): Promise<ProductionScan> {
  const compiler = await compileEntry();
  const sources = [...compiler.sources];

  // `root` は entry CSS の `source(...)` 指定。`"none"` なら自動ソース検出は無効で、
  // 明示した `@source` だけが走査対象になる。`null` は指定なし = 自動ソース検出で、
  // 本番 (`@tailwindcss/postcss`) はリポジトリルートを丸ごと候補にする。
  if (compiler.root === null) {
    sources.unshift({ base: REPO_ROOT, pattern: "**/*", negated: false });
  } else if (compiler.root !== "none") {
    sources.unshift({ ...compiler.root, negated: false });
  }

  const scanner = new Scanner({ sources });
  const candidates = scanner.scan();
  return {
    files: scanner.files.map(toRelative).sort(),
    candidates,
    autoDetection: compiler.root === null,
    declaredBases: compiler.sources
      .filter((source) => !source.negated)
      .map((source) => toRelative(path.resolve(source.base, source.pattern)))
      .sort(),
  };
}

/**
 * git が追跡しているファイル一覧。
 *
 * ファイルシステムを直接歩かないのは、**ローカルにしか無いものを数えないため**。
 * `.claude/worktrees/` には別ブランチのツリーが展開されることがあり
 * (`vitest.config.ts` が同じ理由で `.claude/**` を除外している)、歩くと
 * ローカルと CI で結果が変わる。追跡ファイルなら Vercel へ配られるものと一致する。
 */
export async function gitTrackedFiles(): Promise<string[]> {
  const { stdout } = await execFileAsync("git", ["ls-files", "-z"], {
    cwd: REPO_ROOT,
    maxBuffer: 32 * 1024 * 1024,
  });
  return stdout.split("\0").filter(Boolean).sort();
}

/**
 * テストのために存在するファイルか。**実行時にマークアップを生まない**ものを指す。
 *
 * `__tests__/support/*.ts` はテスト名を持たないヘルパだが、実行時には読まれないので
 * 同じ扱いにする。`app/globals.css` の `@source not` と同じ意味をここでも表現している。
 */
export function isTestPath(relativePath: string): boolean {
  return (
    relativePath.includes("/__tests__/") ||
    relativePath.startsWith("__tests__/") ||
    /(^|\/)[^/]+\.test\.[^/]+$/.test(relativePath)
  );
}
