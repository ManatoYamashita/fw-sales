/**
 * `vercel.json` の cron 定義が実体と噛み合っているかのガード (Issue #242)。
 *
 * なぜ必要か:
 * 1. **存在しないパスでも Vercel は cron を「実行」する。** 公式ドキュメントは
 *    "If you create a cron job for a path that doesn't exist, it generates a 404
 *    error. However, Vercel still executes your cron job" と明記している。
 *    つまりパスの typo やルート改名は、失敗として現れず 404 を返し続けるだけで、
 *    keepalive は静かに死ぬ。デプロイもテストも赤くならない。
 * 2. **Hobby プランは cron を 1 日 1 回までしか許さない。** それを超える式は
 *    実行時ではなく **デプロイ時に失敗**する。本番デプロイが止まる前に PR で落とす。
 *
 * 検証方法の方針: 文字列 grep をしない。`vercel.json` は JSON としてパースし、
 * ルートはファイルシステムを実際に走査して集合として突き合わせる。ソース文字列を
 * 検査する形式のテストは、コメントや撤去記録に自己ヒットして空虚に緑になる
 * (cf. app/(main)/stores/_components/__tests__/store-cascade-fk-coverage.test.ts)。
 *
 * 関連: Issue #242, vercel.json, app/api/cron/keepalive/route.ts
 */

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

interface CronEntry {
  readonly path: string;
  readonly schedule: string;
}

const ROOT = process.cwd();

const vercelConfig = JSON.parse(
  readFileSync(path.join(ROOT, "vercel.json"), "utf8"),
) as { crons?: CronEntry[] };

const crons: CronEntry[] = vercelConfig.crons ?? [];

/** `app/` 配下の route ファイルを実際に走査し、URL パスの集合に変換する。 */
function collectRoutePaths(): Set<string> {
  const found = new Set<string>();
  const appDir = path.join(ROOT, "app");

  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "__tests__" || entry.name === "node_modules") continue;
        walk(full);
        continue;
      }
      if (!/^route\.(ts|tsx|js|jsx|mjs)$/.test(entry.name)) continue;

      const urlPath = path
        .relative(appDir, path.dirname(full))
        .split(path.sep)
        // Route Group `(main)` は URL に現れない。
        .filter((segment) => segment !== "" && !/^\(.*\)$/.test(segment))
        .join("/");
      found.add(`/${urlPath}`);
    }
  };

  walk(appDir);
  return found;
}

describe("vercel.json の cron 定義", () => {
  it("cron が 1 件以上定義されている (定義ごと消えたら keepalive の片肺が黙って落ちる)", () => {
    expect(crons.length).toBeGreaterThan(0);
  });

  it.each(crons.map((cron) => [cron.path, cron] as const))(
    "%s : path が実在する Route Handler を指す",
    (_label, cron) => {
      // Vercel は存在しないパスでも「実行」して 404 を返すため、実体との一致を見る。
      const withoutQuery = cron.path.split("?")[0]!;
      expect(withoutQuery.startsWith("/")).toBe(true);
      expect(collectRoutePaths()).toContain(withoutQuery);
    },
  );

  it.each(crons.map((cron) => [cron.path, cron] as const))(
    "%s : schedule が Hobby プランの『1 日 1 回まで』に収まる",
    (_label, cron) => {
      const fields = cron.schedule.trim().split(/\s+/);
      // Vercel は @daily 等の別名式を受け付けない。5 フィールド固定。
      expect(fields).toHaveLength(5);

      // 分と時が単一のリテラル整数であれば、日/月/曜日は頻度を減らす方向にしか
      // 効かないため、最大でも 1 日 1 回であることが保証される (健全な十分条件)。
      const [minute, hour] = fields as [string, string, string, string, string];
      expect(minute).toMatch(/^\d{1,2}$/);
      expect(hour).toMatch(/^\d{1,2}$/);
      expect(Number(minute)).toBeLessThanOrEqual(59);
      expect(Number(hour)).toBeLessThanOrEqual(23);
    },
  );

  it("keepalive の cron は GitHub Actions 版と時間帯が重ならない", () => {
    // 2 系統を離すのは pause 予防のためではなく (どちらも日次で余裕がある)、
    // 「GHA が読む値が常に約 12 時間前になる」= 鮮度判定が平常のジッタで
    // 揺れないようにするため。.github/workflows/supabase-keepalive.yml は 09:00 UTC。
    const keepalive = crons.find((cron) => cron.path === "/api/cron/keepalive");
    expect(keepalive).toBeDefined();

    const workflow = readFileSync(
      path.join(ROOT, ".github/workflows/supabase-keepalive.yml"),
      "utf8",
    );
    const gha = /cron:\s*"(\d{1,2})\s+(\d{1,2})\s/.exec(workflow);
    expect(gha).not.toBeNull();

    const ghaHour = Number(gha![2]);
    const vercelHour = Number(keepalive!.schedule.trim().split(/\s+/)[1]);
    const gap = Math.abs(ghaHour - vercelHour);
    expect(Math.min(gap, 24 - gap)).toBeGreaterThanOrEqual(6);
  });
});
