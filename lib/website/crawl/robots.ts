/**
 * robots.txt の pure parser / evaluator(RFC 9309 準拠の path matching）。
 *
 * 入力は robots.txt の body 文字列のみ。network I/O・redirect・5xx 等の判断は
 * Phase 2(crawl orchestration)の責務であり、ここには混ぜない。
 *
 * 設計上の不変条件(いずれも「理解できないものは許可しない」方向）:
 * 1. `*` / 終端 `$` を **実装する**。解釈できないから無視して crawl する、は禁止。
 * 2. 解釈できない Disallow 行が 1 件でもあれば `failClosed = true` となり、
 *    `isAllowedByRobots` は全 path に対して false を返す。
 * 3. 一致する User-agent group が複数ある場合は **全て merge** する(RFC 9309 §2.2.1）。
 *
 * 照合対象は **path + query**(RFC 9309 §2.2.2 / Google robots.txt spec）。
 * 例: `Disallow: /*.pdf$` は `/menu.pdf` に一致し、`/menu.pdf?x=1` には一致しない。
 * 呼び出し側は `robotsTargetFromUrl()` を使って照合対象を組み立てること。
 *
 * 正規表現は一切使わない(bounded deterministic matcher）。robots.txt は第三者が
 * 書いた外部入力であり、glob→RegExp 変換は ReDoS / 任意 regex 注入の経路になるため。
 */

import { WEBSITE_SCANNER_USER_AGENT_PRODUCT } from "../user-agent";

const CRAWL_DELAY_MIN_MS = 1000;
const CRAWL_DELAY_MAX_MS = 3000;

/** 1 本の Allow / Disallow rule。`raw` は specificity 比較に使う元の値。 */
export interface RobotsPathRule {
  /** robots.txt に書かれていた元の値(`/*.pdf$` 等）。specificity = この長さ。 */
  raw: string;
  /** `*` で分割した literal 断片。 */
  segments: string[];
  /** 終端 `$` が付いていたか(path 全体一致を要求する）。 */
  anchored: boolean;
}

export interface UnsupportedRobotsRule {
  field: "allow" | "disallow";
  value: string;
}

export interface RobotsRules {
  disallowRules: RobotsPathRule[];
  allowRules: RobotsPathRule[];
  /** [1000, 3000] へ clamp 済み。Crawl-delay 指定が無ければ null。 */
  crawlDelayMs: number | null;
  /** 解釈できなかった行。監査・警告表示用。 */
  unsupportedRules: UnsupportedRobotsRule[];
  /**
   * 解釈できない **Disallow** 行が存在したか。true のとき crawl してはならない。
   * (解釈できない Allow は無視しても over-block 方向にしか働かないため fail-closed にしない）
   */
  failClosed: boolean;
}

export type RobotsDecision = "allowed" | "disallowed" | "unsupported_fail_closed";

type RuleLine =
  | { type: "disallow"; value: string }
  | { type: "allow"; value: string }
  | { type: "crawl-delay"; seconds: number };

interface Group {
  agents: string[];
  rules: RuleLine[];
  /** rule 行(allow/disallow)を 1 つでも読んだか。次の User-agent 行で group を切る判定に使う。 */
  closedForAgents: boolean;
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(Math.max(n, min), max);
}

/**
 * robots.txt の値を rule へコンパイルする。解釈できなければ null。
 *
 * サポートする構文は RFC 9309 の path pattern が定めるものが全てである:
 * - `*`  … 任意の 0 文字以上
 * - 終端 `$` … path の末尾に固定
 * 途中に現れる `$` は literal(RFC 9309 上 `$` が特別なのは末尾のみ）。
 */
export function compilePathRule(value: string): RobotsPathRule | null {
  // path は `/` 始まり。`*` 始まり(`Disallow: *` 等の慣用表記)も受け入れる。
  if (!value.startsWith("/") && !value.startsWith("*")) return null;

  const anchored = value.endsWith("$");
  const body = anchored ? value.slice(0, -1) : value;
  return { raw: value, segments: body.split("*"), anchored };
}

/**
 * bounded deterministic glob matcher。RegExp を使わない。
 *
 * `*` のみを含む glob では「各 literal 断片を最左で一致させる」貪欲法が正しい
 * (早く一致させるほど後続に残る余地が広がるため）。終端 `$` が付く場合のみ、
 * 最後の断片を path 末尾へ固定して判定する。
 *
 * 計算量は O(|path| × |segments|) で入力長に対して有界。後戻り(backtracking)は無い。
 */
export function matchesPathRule(rule: RobotsPathRule, target: string): boolean {
  const { segments, anchored } = rule;

  // `*` を含まない場合
  if (segments.length === 1) {
    const only = segments[0]!;
    return anchored ? target === only : target.startsWith(only);
  }

  const first = segments[0]!;
  if (!target.startsWith(first)) return false;
  let pos = first.length;

  // 中間の断片(最後の 1 つを除く)を最左一致で消化する
  for (let i = 1; i < segments.length - 1; i++) {
    const seg = segments[i]!;
    if (seg === "") continue;
    const idx = target.indexOf(seg, pos);
    if (idx === -1) return false;
    pos = idx + seg.length;
  }

  const last = segments[segments.length - 1]!;
  if (anchored) {
    // 終端 `$`: 最後の断片は path の末尾ちょうどに来なければならない
    const requiredStart = target.length - last.length;
    return requiredStart >= pos && target.startsWith(last, requiredStart);
  }
  if (last === "") return true; // pattern が `*` で終わる → 残りは何でもよい
  return target.indexOf(last, pos) !== -1;
}

function parseGroups(body: string): Group[] {
  const groups: Group[] = [];
  let current: Group | null = null;

  for (const rawLine of body.split(/\r\n|\r|\n/)) {
    const line = (rawLine.split("#")[0] ?? "").trim();
    if (line === "") continue;

    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const field = line.slice(0, colonIdx).trim().toLowerCase();
    const value = line.slice(colonIdx + 1).trim();

    if (field === "user-agent") {
      // 連続する User-agent 行(間に Crawl-delay を挟む場合も含む)は同一 group。
      // Allow/Disallow を読んだ後の User-agent 行だけが新しい group を開始する
      // (RFC 9309 §2.2.1 の group 定義。Crawl-delay は group を分割しない）。
      if (current && !current.closedForAgents) {
        current.agents.push(value);
      } else {
        current = { agents: [value], rules: [], closedForAgents: false };
        groups.push(current);
      }
      continue;
    }

    if (!current) continue; // User-agent 行より前の rule は無視(非準拠ファイルの防御的扱い）

    if (field === "disallow") {
      current.rules.push({ type: "disallow", value });
      current.closedForAgents = true;
    } else if (field === "allow") {
      current.rules.push({ type: "allow", value });
      current.closedForAgents = true;
    } else if (field === "crawl-delay") {
      // Crawl-delay は access rule ではなく group の metadata。group を分割しない。
      const n = Number.parseFloat(value);
      if (Number.isFinite(n) && n >= 0) {
        current.rules.push({ type: "crawl-delay", seconds: n });
      }
    }
    // sitemap 等その他フィールドは無視
  }

  return groups;
}

/**
 * 一致する group を **全て** 返す(RFC 9309 §2.2.1: 同一 User-agent の group は merge）。
 * 専用 UA group が 1 件以上あれば `*` group は混ぜない。専用が 0 件なら全 `*` group を返す。
 */
function selectGroups(groups: readonly Group[]): Group[] {
  const product = WEBSITE_SCANNER_USER_AGENT_PRODUCT.toLowerCase();
  const exact = groups.filter((g) => g.agents.some((a) => a.toLowerCase() === product));
  if (exact.length > 0) return exact;
  return groups.filter((g) => g.agents.some((a) => a === "*"));
}

/**
 * robots.txt の body を解析する。
 * - 一致する group を全て merge(専用 UA があれば `*` は使わない）
 * - `*` / 終端 `$` を含む pattern を解釈する
 * - 解釈できない Disallow が 1 件でもあれば `failClosed = true`
 * - Crawl-delay は複数あれば **最大値**(最も保守的)を採り、[1000, 3000]ms へ clamp
 */
export function parseRobotsTxt(body: string): RobotsRules {
  const selected = selectGroups(parseGroups(body));

  const disallowRules: RobotsPathRule[] = [];
  const allowRules: RobotsPathRule[] = [];
  const unsupportedRules: UnsupportedRobotsRule[] = [];
  let crawlDelaySecondsMax: number | null = null;
  let failClosed = false;

  for (const group of selected) {
    for (const rule of group.rules) {
      if (rule.type === "crawl-delay") {
        crawlDelaySecondsMax =
          crawlDelaySecondsMax === null ? rule.seconds : Math.max(crawlDelaySecondsMax, rule.seconds);
        continue;
      }

      // 空 Disallow は「制限なし」を意味する(RFC 9309）。空 Allow も同様に無意味。
      if (rule.value === "") continue;

      const compiled = compilePathRule(rule.value);
      if (compiled === null) {
        unsupportedRules.push({ field: rule.type, value: rule.value });
        // 解釈できない Disallow を無視すると under-block(= 禁止されたページを crawl）に
        // なるため fail-closed。Allow の取りこぼしは over-block 方向なので許容する。
        if (rule.type === "disallow") failClosed = true;
        continue;
      }

      if (rule.type === "disallow") disallowRules.push(compiled);
      else allowRules.push(compiled);
    }
  }

  return {
    disallowRules,
    allowRules,
    crawlDelayMs:
      crawlDelaySecondsMax === null
        ? null
        : clamp(crawlDelaySecondsMax * 1000, CRAWL_DELAY_MIN_MS, CRAWL_DELAY_MAX_MS),
    unsupportedRules,
    failClosed,
  };
}

/** 一致した rule のうち最大 specificity(= pattern 文字列長）を返す。一致無しは -1。 */
function bestSpecificity(rules: readonly RobotsPathRule[], target: string): number {
  let best = -1;
  for (const rule of rules) {
    if (rule.raw.length > best && matchesPathRule(rule, target)) best = rule.raw.length;
  }
  return best;
}

/**
 * robots 判定(RFC 9309 §2.2.2）。
 * specificity(pattern 文字列長）が最大の rule が勝ち、同 specificity なら Allow が勝つ。
 * 解釈できない Disallow があった場合は `unsupported_fail_closed`(crawl してはならない）。
 *
 * `target` は path + query(`robotsTargetFromUrl()` で組み立てる）。
 */
export function evaluateRobots(rules: RobotsRules, target: string): RobotsDecision {
  if (rules.failClosed) return "unsupported_fail_closed";

  const disallow = bestSpecificity(rules.disallowRules, target);
  if (disallow === -1) return "allowed";
  const allow = bestSpecificity(rules.allowRules, target);
  return allow >= disallow ? "allowed" : "disallowed";
}

/**
 * crawl してよいかの boolean。`unsupported_fail_closed` は **false**(許可しない)へ倒す。
 * 「理解できないから許可」は起こらない。
 */
export function isAllowedByRobots(rules: RobotsRules, target: string): boolean {
  return evaluateRobots(rules, target) === "allowed";
}

/**
 * URL から robots 照合対象(path + query）を組み立てる。パース不能なら null。
 * 照合対象の定義を 1 箇所に閉じ込め、呼び出し側ごとに path だけ / query 込み が
 * ばらつくことを防ぐ。
 */
export function robotsTargetFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return null;
  }
}
