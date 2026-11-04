import { describe, expect, it } from "vitest";
import {
  isNextServerProcess,
  parseArgs,
  parseThreadCpu,
  selectInspectorTarget,
  summarizeCallFrames,
} from "../diagnose-dev-server.mjs";

const ROOT = "/Users/dev/fw-sales";

describe("parseArgs (#328)", () => {
  it("指定が無ければ inspector は 9229、CPU プロファイルは 10 秒", () => {
    expect(parseArgs([])).toEqual({ port: undefined, out: undefined, profileSeconds: 10, inspectPort: 9229 });
  });

  it("ポート・書き出し先・秒数を読む", () => {
    expect(parseArgs(["--port", "3328", "--out", "/tmp/x", "--profile-seconds", "5", "--inspect-port", "9330"])).toEqual({
      port: "3328",
      out: "/tmp/x",
      profileSeconds: 5,
      inspectPort: 9330,
    });
  });

  it("pnpm がそのまま渡す単独の -- は読み飛ばす", () => {
    expect(parseArgs(["--", "--port", "3200"]).port).toBe("3200");
  });

  it("知らない引数・値の欠け・整数でない秒数は、取り違えたまま採らないよう例外にする", () => {
    expect(() => parseArgs(["--pid", "1"])).toThrow("不明な引数");
    expect(() => parseArgs(["--port"])).toThrow("値がありません");
    expect(() => parseArgs(["--out", "--port", "3200"])).toThrow("値がありません");
    expect(() => parseArgs(["--profile-seconds", "1.5"])).toThrow("1 以上の整数");
    expect(() => parseArgs(["--profile-seconds", "0"])).toThrow("1 以上の整数");
  });
});

describe("parseThreadCpu (#328)", () => {
  it("先頭スレッドの行だけ列が多い ps -M の出力から、スレッドごとの CPU を大きい順に読む", () => {
    const output = [
      "USER          PID   TT   %CPU STAT PRI     STIME     UTIME COMMAND",
      "manatoy     12330   ??    0.4 S    31T   0:01.20   0:09.30 next-server (v16.3.1)",
      "            12330        97.5 R    31T   0:00.00   1:02.00",
      "            12330         1.2 S    31T   0:00.10   0:00.20",
    ].join("\n");
    expect(parseThreadCpu(output)).toEqual([97.5, 1.2, 0.4]);
  });
});

describe("isNextServerProcess (#328)", () => {
  it("このチェックアウトを作業ディレクトリにする next-server だけを対象にする", () => {
    expect(isNextServerProcess({ command: "next-server (v16.3.1)", cwd: ROOT }, ROOT)).toBe(true);
  });

  it("前方一致する別の worktree のサーバーには信号を送らない", () => {
    expect(isNextServerProcess({ command: "next-server (v16.3.1)", cwd: `${ROOT}-328` }, ROOT)).toBe(false);
  });

  it("next-server でないプロセスや、作業ディレクトリが分からないプロセスは対象にしない", () => {
    expect(isNextServerProcess({ command: "node scripts/local-preview.mjs start", cwd: ROOT }, ROOT)).toBe(false);
    expect(isNextServerProcess({ command: "next-server (v16.3.1)", cwd: null }, ROOT)).toBe(false);
  });
});

describe("selectInspectorTarget (#328)", () => {
  const target = (dir: string) => ({
    url: `file://${dir}/node_modules/next/dist/server/lib/start-server.js`,
    webSocketDebuggerUrl: `ws://127.0.0.1:9229/${dir.length}`,
  });

  it("このチェックアウトのスクリプトを実行している接続先を選ぶ", () => {
    expect(selectInspectorTarget([target("/Users/dev/other"), target(ROOT)], ROOT)).toEqual(target(ROOT));
  });

  it("前方一致する別のチェックアウトの接続先は選ばない", () => {
    expect(selectInspectorTarget([target(`${ROOT}-328`)], ROOT)).toBeNull();
  });
});

describe("summarizeCallFrames (#328)", () => {
  it("プロジェクト内のファイルは相対パスにし、行番号を 1 始まりにする", () => {
    const frames = [
      { functionName: "render", url: `file://${ROOT}/.next/dev/server/chunks/page.js`, location: { lineNumber: 41 } },
      { functionName: "", url: "node:internal/timers", location: { lineNumber: 0 } },
    ];
    expect(summarizeCallFrames(frames, ROOT)).toEqual([
      "render .next/dev/server/chunks/page.js:42",
      "(anonymous) node:internal/timers:1",
    ]);
  });

  it("url が空のフレームは scriptId から URL を引き直し、引けなければ (unknown) にする", () => {
    // callFrame.url は非推奨で、実際の Node では空になる (#328 の検証で確認)
    const frames = [
      { functionName: "spinForever", url: "", location: { scriptId: "42", lineNumber: 4 } },
      { functionName: "emit", url: "", location: { scriptId: "99", lineNumber: 507 } },
    ];
    const scriptUrls = new Map([["42", `file://${ROOT}/.local-preview/fake-hung-server.mjs`]]);
    expect(summarizeCallFrames(frames, ROOT, scriptUrls)).toEqual([
      "spinForever .local-preview/fake-hung-server.mjs:5",
      "emit (unknown):508",
    ]);
  });
});
