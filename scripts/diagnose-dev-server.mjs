// ローカル検証サーバー (pnpm dev:local) が応答しなくなったとき、再起動する前に状態を書き出す (#328)。
//
//   pnpm local:diagnose [--port <番号>] [--out <ディレクトリ>] [--profile-seconds <秒>] [--inspect-port <番号>]
//
// ポートの既定は LOCAL_PREVIEW_PORT (.env.local-preview) か 3200。書き出し先の既定は
// .local-preview/diagnostics/<日時>/ (git の管理外)。採るものは次のとおりで、サーバーは止めない。
//
// 1. タイムアウト付きの /login の応答 (プロセスとポートが残っていても、応答しないことがある)
// 2. next-server と親プロセスの CPU・メモリ、スレッドごとの CPU
// 3. 全スレッドのネイティブスタック (macOS の sample。Turbopack の Rust スレッドを含む)
// 4. 開いているファイル・ソケット (lsof)
// 5. .next/dev/trace と .next/dev/logs/next-development.log の写し
// 6. inspector 経由の、その瞬間の JS スタック・CPU プロファイル・Node の診断レポート・ヒープ使用量
//
// inspector は SIGUSR1 で開き (Node の既定の動作で、プロセスは止まらない)、最後に閉じる。
// SIGUSR2 は送らない。--report-on-signal を付けずに起動した Node は SIGUSR2 で終了するため。
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { PROJECT_ROOT } from "./e2e-local.mjs";
import { getLocalPreviewConfig } from "./local-preview.mjs";

/** Node が SIGUSR1 で開く inspector の既定ポート。 */
const DEFAULT_INSPECT_PORT = 9229;
const DEFAULT_PROFILE_SECONDS = 10;
const PROBE_TIMEOUT_MS = 10_000;
const SAMPLE_SECONDS = 10;
/** JS スタックを採るとき、一時停止を待つ上限。超えたら JS を実行していないとみなす。 */
const PAUSE_TIMEOUT_MS = 5_000;

const OPTIONS = {
  "--port": "port",
  "--out": "out",
  "--profile-seconds": "profileSeconds",
  "--inspect-port": "inspectPort",
};

/**
 * コマンドライン引数を読む。知らない引数や値の欠けは、取り違えたまま採らないよう例外にする。
 * @param {string[]} argv
 * @returns {{ port?: string, out?: string, profileSeconds: number, inspectPort: number }}
 */
export function parseArgs(argv) {
  /** @type {Record<string, string>} */
  const raw = {};
  for (let i = 0; i < argv.length; i++) {
    // pnpm はスクリプト名の後の "--" をそのまま渡す。npm の書き方で打たれても通す。
    if (argv[i] === "--") continue;
    const key = OPTIONS[argv[i]];
    if (!key) throw new Error(`不明な引数です: ${argv[i]}`);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) throw new Error(`${argv[i]} の値がありません。`);
    raw[key] = value;
    i++;
  }
  const toPositiveInt = (name, value, fallback) => {
    if (value === undefined) return fallback;
    const n = Number(value);
    if (!/^\d+$/.test(value) || n < 1) throw new Error(`${name} は 1 以上の整数で指定してください。`);
    return n;
  };
  return {
    port: raw.port,
    out: raw.out,
    profileSeconds: toPositiveInt("--profile-seconds", raw.profileSeconds, DEFAULT_PROFILE_SECONDS),
    inspectPort: toPositiveInt("--inspect-port", raw.inspectPort, DEFAULT_INSPECT_PORT),
  };
}

/**
 * `ps -M -p <pid>` の出力から、スレッドごとの CPU (%) を大きい順に返す。
 * 先頭スレッドの行にだけ USER と TT が付いて列位置がずれるため、各行で最初の小数の列を
 * %CPU として読む (STIME・UTIME は ":" を含むので当たらない)。
 * @param {string} output
 * @returns {number[]}
 */
export function parseThreadCpu(output) {
  return output
    .trim()
    .split("\n")
    .slice(1)
    .map((line) => Number(line.trim().split(/\s+/).find((token) => /^\d+\.\d+$/.test(token))))
    .filter(Number.isFinite)
    .sort((a, b) => b - a);
}

/**
 * 待ち受けているプロセスが、このチェックアウトの next-server かを確かめる。
 * next-server は process.title を書き換えるため、コマンドラインにパスが出ない。そこで作業
 * ディレクトリで見分ける (別の worktree のサーバーへ信号を送らないため)。
 * @param {{ command: string, cwd: string | null }} proc
 * @param {string} projectRoot
 */
export function isNextServerProcess(proc, projectRoot) {
  return proc.command.trim().startsWith("next-server") && proc.cwd !== null && path.resolve(proc.cwd) === path.resolve(projectRoot);
}

/**
 * inspector の接続先のうち、このチェックアウトのスクリプトを実行しているものを選ぶ。
 * `fw-sales` と `fw-sales-328` のように前方一致する別のチェックアウトを取り違えないよう、
 * 末尾に "/" を付けて比べる。
 * @param {Array<{ url?: string, webSocketDebuggerUrl?: string }>} targets
 * @param {string} projectRoot
 */
export function selectInspectorTarget(targets, projectRoot) {
  const prefix = `${pathToFileURL(path.resolve(projectRoot)).href}/`;
  return targets.find((target) => target.url?.startsWith(prefix) && target.webSocketDebuggerUrl) ?? null;
}

/**
 * Debugger.paused の callFrames を、読みやすい 1 行ずつの形にする。
 * `callFrame.url` は非推奨で空のことがあるため、Debugger.scriptParsed で集めた scriptId → URL で引き直す。
 * @param {Array<{ functionName: string, url?: string, location: { scriptId?: string, lineNumber: number } }>} callFrames
 * @param {string} projectRoot
 * @param {Map<string, string>} [scriptUrls]
 */
export function summarizeCallFrames(callFrames, projectRoot, scriptUrls = new Map()) {
  const prefix = `${pathToFileURL(path.resolve(projectRoot)).href}/`;
  return callFrames.map((frame) => {
    const url = frame.url || scriptUrls.get(frame.location.scriptId ?? "") || "";
    const file = url.startsWith(prefix) ? url.slice(prefix.length) : url || "(unknown)";
    return `${frame.functionName || "(anonymous)"} ${file}:${frame.location.lineNumber + 1}`;
  });
}

/** @param {Date} date */
function formatTimestamp(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

/** @param {string} cmd @param {string[]} args */
function run(cmd, args, timeout = 30_000) {
  return execFileSync(cmd, args, { encoding: "utf8", timeout, maxBuffer: 64 * 1024 * 1024 });
}

/** @param {number} port */
function listeningPid(port) {
  try {
    return Number(run("lsof", ["-nP", `-tiTCP:${port}`, "-sTCP:LISTEN"]).trim().split("\n")[0]) || null;
  } catch {
    return null;
  }
}

/** @param {number} pid */
function processCwd(pid) {
  try {
    const line = run("lsof", ["-a", "-p", String(pid), "-d", "cwd", "-Fn"]).split("\n").find((l) => l.startsWith("n"));
    return line ? line.slice(1) : null;
  } catch {
    return null;
  }
}

function withTimeout(promise, ms, label) {
  // ref: false にして、待ちの上限のタイマーが診断の終了を引き止めないようにする。
  const limit = sleep(ms, undefined, { ref: false }).then(() => {
    throw new Error(`${label} が ${ms}ms で終わりませんでした`);
  });
  return Promise.race([promise, limit]);
}

/** inspector の 1 接続。応答の来ない命令で全体が止まらないよう、命令ごとに上限を設ける。 */
async function connectInspector(webSocketDebuggerUrl) {
  const ws = new WebSocket(webSocketDebuggerUrl);
  await withTimeout(new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; }), 5_000, "inspector への接続");
  let nextId = 0;
  const pending = new Map();
  /** @type {Map<string, Set<(params: any) => void>>} */
  const listeners = new Map();
  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      pending.get(message.id)(message);
      pending.delete(message.id);
    } else if (message.method) {
      for (const listener of listeners.get(message.method) ?? []) listener(message.params);
    }
  };
  /** 通知を受け取る。戻り値を呼ぶと受け取りをやめる。 */
  const on = (method, listener) => {
    if (!listeners.has(method)) listeners.set(method, new Set());
    listeners.get(method).add(listener);
    return () => listeners.get(method).delete(listener);
  };
  return {
    on,
    once(method) {
      return new Promise((resolve) => {
        const off = on(method, (params) => {
          off();
          resolve(params);
        });
      });
    },
    send(method, params = {}, timeoutMs = 20_000) {
      const id = ++nextId;
      const reply = new Promise((resolve) => pending.set(id, resolve));
      ws.send(JSON.stringify({ id, method, params }));
      return withTimeout(reply, timeoutMs, method);
    },
    /** 応答を待たずに送る (inspector を閉じる命令は、応答の前に接続が切れる)。 */
    fire(method, params = {}) {
      ws.send(JSON.stringify({ id: ++nextId, method, params }));
    },
    close() {
      ws.close();
    },
  };
}

/**
 * inspector を開いて、JS スタック・CPU プロファイル・診断レポート・ヒープ使用量を採る。
 * @returns {Promise<Record<string, unknown>>}
 */
async function captureViaInspector({ pid, inspectPort, outDir, profileSeconds }) {
  const occupant = listeningPid(inspectPort);
  if (occupant && occupant !== pid) {
    return {
      skipped: `ポート ${inspectPort} を別のプロセス (pid ${occupant}) が使っているため、inspector 経由の採取を省きました。別のポートで採るには、サーバーを NODE_OPTIONS=--inspect-port=<番号> 付きで起動し、--inspect-port に同じ番号を渡します。`,
    };
  }
  process.kill(pid, "SIGUSR1");
  let targets = null;
  for (let i = 0; i < 25 && !targets; i++) {
    await sleep(200);
    targets = await fetch(`http://127.0.0.1:${inspectPort}/json/list`, { signal: AbortSignal.timeout(2_000) })
      .then((res) => res.json())
      .catch(() => null);
  }
  const target = targets && selectInspectorTarget(targets, PROJECT_ROOT);
  if (!target) return { skipped: "inspector の接続先に、このチェックアウトの next-server が見つかりませんでした。" };

  const inspector = await connectInspector(target.webSocketDebuggerUrl);
  /** @type {Record<string, unknown>} */
  const result = {};
  try {
    // その瞬間の JS スタック。JS が回り続けていても一時停止できる。止まらなければ、JS ではなく
    // ネイティブの処理か I/O 待ちで止まっている。scriptParsed は enable のときに既存の全スクリプト分届く。
    const scriptUrls = new Map();
    inspector.on("Debugger.scriptParsed", (script) => scriptUrls.set(script.scriptId, script.url));
    await inspector.send("Debugger.enable");
    const paused = inspector.once("Debugger.paused");
    await inspector.send("Debugger.pause");
    const params = await withTimeout(paused, PAUSE_TIMEOUT_MS, "Debugger.pause").catch(() => null);
    try {
      if (params) {
        const frames = summarizeCallFrames(params.callFrames, PROJECT_ROOT, scriptUrls);
        fs.writeFileSync(path.join(outDir, "js-stack.txt"), `${frames.join("\n")}\n`);
        result.jsStackTop = frames.slice(0, 5);
      } else {
        result.jsStackTop = null;
        result.jsPause = `${PAUSE_TIMEOUT_MS}ms 以内に一時停止できませんでした (JS を実行していない)。`;
      }
    } finally {
      // 一時停止したままにすると、健全なサーバーまで止めてしまう。書き出しに失敗しても必ず再開する。
      await inspector.send("Debugger.resume").catch(() => {});
      await inspector.send("Debugger.disable").catch(() => {});
    }

    await inspector.send("Profiler.enable");
    await inspector.send("Profiler.start");
    await sleep(profileSeconds * 1000);
    const { result: profile } = await inspector.send("Profiler.stop", {}, 60_000);
    fs.writeFileSync(path.join(outDir, "cpu.cpuprofile"), JSON.stringify(profile.profile));
    result.cpuProfile = "cpu.cpuprofile";

    const reportPath = path.join(outDir, "node-report.json");
    const report = await inspector.send("Runtime.evaluate", {
      expression: `process.report.writeReport(${JSON.stringify(reportPath)})`,
      returnByValue: true,
    });
    result.nodeReport = report.result?.result?.value ? "node-report.json" : `書き出せませんでした: ${JSON.stringify(report.result).slice(0, 200)}`;

    const heap = await inspector.send("Runtime.getHeapUsage");
    result.heapUsedMB = Math.round((heap.result?.usedSize ?? 0) / 1024 / 1024);
    result.heapTotalMB = Math.round((heap.result?.totalSize ?? 0) / 1024 / 1024);
  } catch (error) {
    result.error = String(error);
  } finally {
    // 開いたままにすると、同じユーザーの別のプロセスから接続できてしまうため閉じる。
    // 接続が先に切れていても、ここまでの結果は返す。
    try {
      inspector.fire("Runtime.evaluate", { expression: "process._debugEnd()" });
      inspector.close();
    } catch (error) {
      result.closeError = String(error);
    }
    await sleep(500);
    result.inspectorClosed = listeningPid(inspectPort) !== pid;
  }
  return result;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { port, baseUrl } = getLocalPreviewConfig({ ...process.env, LOCAL_PREVIEW_PORT: args.port ?? process.env.LOCAL_PREVIEW_PORT });
  const pid = listeningPid(port);
  if (!pid) throw new Error(`ポート ${port} で待ち受けているプロセスがありません。--port で指定してください。`);
  const proc = { command: run("ps", ["-o", "command=", "-p", String(pid)]).trim(), cwd: processCwd(pid) };
  if (!isNextServerProcess(proc, PROJECT_ROOT)) {
    throw new Error(`ポート ${port} のプロセス (pid ${pid}: ${proc.command} / ${proc.cwd}) は、このチェックアウトの next-server ではありません。別の worktree のサーバーなら、その worktree で実行してください。`);
  }

  const outDir = path.resolve(args.out ?? path.join(PROJECT_ROOT, ".local-preview", "diagnostics", formatTimestamp(new Date())));
  fs.mkdirSync(outDir, { recursive: true });
  /** @type {Record<string, unknown>} */
  const summary = { capturedAt: new Date().toISOString(), port, pid, outDir, loadAverage: os.loadavg() };
  // 1 つの手順が失敗しても、残りの手順は続ける (固まったサーバーでは、どれが採れるか分からない)。
  const step = async (name, fn) => {
    console.log(`[diagnose] ${name}`);
    try {
      summary[name] = await fn();
    } catch (error) {
      summary[name] = { error: String(error) };
    }
    return summary[name];
  };

  const probe = await step("probe", async () => {
    const started = Date.now();
    try {
      const res = await fetch(`${baseUrl}/login`, { redirect: "manual", signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
      await res.arrayBuffer();
      return { ok: true, status: res.status, ms: Date.now() - started };
    } catch (error) {
      return { ok: false, error: error.name, ms: Date.now() - started };
    }
  });
  const stats = await step("process", () => {
    const stat = run("ps", ["-o", "pid=,ppid=,etime=,%cpu=,rss=,command=", "-p", String(pid)]).trim();
    const ppid = stat.split(/\s+/)[1];
    const parent = run("ps", ["-o", "pid=,ppid=,etime=,%cpu=,rss=,command=", "-p", ppid]).trim();
    fs.writeFileSync(path.join(outDir, "processes.txt"), `${stat}\n${parent}\n`);
    const threads = parseThreadCpu(run("ps", ["-M", "-p", String(pid)]));
    const [, , etime, cpu, rss] = stat.split(/\s+/);
    return { etime, cpu: Number(cpu), rssMB: Math.round(Number(rss) / 1024), threads: threads.length, topThreadCpu: threads.slice(0, 5) };
  });
  await step("nativeStacks", () => {
    if (process.platform !== "darwin") return { skipped: "sample は macOS でのみ使えます。" };
    const res = spawnSync("sample", [String(pid), String(SAMPLE_SECONDS), "-file", path.join(outDir, "sample.txt")], { timeout: (SAMPLE_SECONDS + 30) * 1000 });
    return res.status === 0 ? "sample.txt" : { error: `sample の終了コード ${res.status}` };
  });
  await step("openFiles", () => {
    const lsof = run("lsof", ["-nP", "-p", String(pid)]);
    fs.writeFileSync(path.join(outDir, "lsof.txt"), lsof);
    return { count: lsof.trim().split("\n").length - 1 };
  });
  await step("devFiles", () => {
    const copied = [];
    for (const rel of [".next/dev/trace", ".next/dev/logs/next-development.log"]) {
      const from = path.join(PROJECT_ROOT, rel);
      if (!fs.existsSync(from)) continue;
      fs.copyFileSync(from, path.join(outDir, path.basename(rel)));
      copied.push(rel);
    }
    return copied;
  });
  const inspector = await step("inspector", () =>
    captureViaInspector({ pid, inspectPort: args.inspectPort, outDir, profileSeconds: args.profileSeconds }),
  );

  fs.writeFileSync(path.join(outDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
  console.log("");
  console.log(`[diagnose] 書き出し先: ${outDir}`);
  console.log(`[diagnose] /login: ${probe.ok ? `${probe.status} (${probe.ms}ms)` : `応答なし (${probe.error}、${probe.ms}ms)`}`);
  if (!stats.error) {
    console.log(`[diagnose] CPU ${stats.cpu}% / RSS ${stats.rssMB}MB / 稼働 ${stats.etime} / スレッド上位 ${stats.topThreadCpu.join(", ")}%`);
  }
  if (inspector.jsStackTop) console.log(`[diagnose] その瞬間の JS: ${inspector.jsStackTop[0]}`);
  else if (inspector.jsPause) console.log(`[diagnose] ${inspector.jsPause}`);
  else if (inspector.skipped) console.log(`[diagnose] inspector: ${inspector.skipped}`);
  else if (inspector.error) console.log(`[diagnose] inspector で採れませんでした: ${inspector.error}`);
  console.log("[diagnose] このフォルダを #328 に共有してから、起動ターミナルで Ctrl+C し、pnpm dev:local で起動し直してください。");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error("[diagnose]", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
