import { describe, expect, it } from "vitest";
import {
  parseRobotsTxt,
  isAllowedByRobots,
  evaluateRobots,
  compilePathRule,
  matchesPathRule,
  robotsTargetFromUrl,
} from "../robots";
import { WEBSITE_SCANNER_USER_AGENT_PRODUCT } from "../../user-agent";

const UA = WEBSITE_SCANNER_USER_AGENT_PRODUCT;

/** テスト内で rule 由来の判定を簡潔に書くためのヘルパ。 */
function allows(body: string, target: string): boolean {
  return isAllowedByRobots(parseRobotsTxt(body), target);
}

describe("parseRobotsTxt: group selection", () => {
  it("専用UAセクションを優先する", () => {
    const body = `
User-agent: *
Disallow: /private

User-agent: ${UA}
Disallow: /only-for-us
`;
    expect(allows(body, "/private")).toBe(true);
    expect(allows(body, "/only-for-us")).toBe(false);
  });

  it("専用セクションが無ければ * にフォールバックする", () => {
    const body = `
User-agent: *
Disallow: /private
`;
    expect(allows(body, "/private")).toBe(false);
  });

  it("該当セクションが無ければ制限なし", () => {
    const body = `
User-agent: SomeOtherBot
Disallow: /private
`;
    const rules = parseRobotsTxt(body);
    expect(rules.disallowRules).toEqual([]);
    expect(rules.allowRules).toEqual([]);
    expect(isAllowedByRobots(rules, "/private")).toBe(true);
  });

  it("連続するUser-agent行を同一groupとして扱う", () => {
    const body = `
User-agent: A
User-agent: ${UA}
Disallow: /x
`;
    expect(allows(body, "/x")).toBe(false);
  });

  it("UA名の大文字小文字を無視して一致する", () => {
    const body = `User-agent: ${UA.toUpperCase()}\nDisallow: /uc`;
    expect(allows(body, "/uc")).toBe(false);
  });

  it("robots parser は共有 product token を使う(手書き文字列を持たない)", () => {
    // 共有定数を書き換えれば parser の照合対象も変わることを確認する
    const body = `User-agent: ${UA}\nDisallow: /shared-const`;
    expect(allows(body, "/shared-const")).toBe(false);
    // 別名のUAセクションには反応しない
    expect(allows(`User-agent: SomethingElse\nDisallow: /shared-const`, "/shared-const")).toBe(true);
  });
});

describe("parseRobotsTxt: 同一UAの複数groupをmergeする(RFC 9309 §2.2.1)", () => {
  it("* group が複数あれば全てmergeする", () => {
    const body = `
User-agent: *
Disallow: /a

User-agent: *
Disallow: /b
`;
    expect(allows(body, "/a")).toBe(false);
    expect(allows(body, "/b")).toBe(false);
    expect(allows(body, "/c")).toBe(true);
  });

  it("専用UA group が複数あれば全てmergeする", () => {
    const body = `
User-agent: ${UA}
Disallow: /a

User-agent: ${UA}
Disallow: /b
`;
    expect(allows(body, "/a")).toBe(false);
    expect(allows(body, "/b")).toBe(false);
  });

  it("専用UA groupが1件でも存在すれば * groupのruleを混ぜない", () => {
    const body = `
User-agent: *
Disallow: /star-only

User-agent: ${UA}
Disallow: /ours

User-agent: *
Disallow: /star-two
`;
    expect(allows(body, "/ours")).toBe(false);
    expect(allows(body, "/star-only")).toBe(true);
    expect(allows(body, "/star-two")).toBe(true);
  });

  it("mergeしたgroup間でAllow/Disallowが正しく作用する", () => {
    const body = `
User-agent: *
Disallow: /admin

User-agent: *
Allow: /admin/public
`;
    expect(allows(body, "/admin/secret")).toBe(false);
    expect(allows(body, "/admin/public/page")).toBe(true);
  });
});

describe("compilePathRule / matchesPathRule: ワイルドカードと終端$", () => {
  function match(pattern: string, target: string): boolean {
    const rule = compilePathRule(pattern);
    expect(rule).not.toBeNull();
    return matchesPathRule(rule!, target);
  }

  it("ワイルドカード無しは prefix 一致", () => {
    expect(match("/admin", "/admin")).toBe(true);
    expect(match("/admin", "/admin/x")).toBe(true);
    expect(match("/admin", "/administrator")).toBe(true);
    expect(match("/admin", "/other")).toBe(false);
  });

  it("終端$は完全一致を要求する", () => {
    expect(match("/admin$", "/admin")).toBe(true);
    expect(match("/admin$", "/admin/x")).toBe(false);
    expect(match("/admin$", "/administrator")).toBe(false);
  });

  it("* は任意の0文字以上に一致する", () => {
    expect(match("/*", "/")).toBe(true);
    expect(match("/*", "/menu")).toBe(true);
    expect(match("/private/*", "/private/a")).toBe(true);
    expect(match("/private/*", "/private/")).toBe(true);
    expect(match("/private/*", "/public/a")).toBe(false);
  });

  it("* と 終端$ の組合せ", () => {
    expect(match("/*.pdf$", "/menu.pdf")).toBe(true);
    expect(match("/*.pdf$", "/a/b/menu.pdf")).toBe(true);
    expect(match("/*.pdf$", "/menu.pdf?x=1")).toBe(false);
    expect(match("/*.pdf$", "/menu.pdfx")).toBe(false);
  });

  it("複数の * を含むpattern", () => {
    expect(match("/a*b*c", "/aXXbYYcZZ")).toBe(true);
    expect(match("/a*b*c$", "/aXXbYYc")).toBe(true);
    expect(match("/a*b*c$", "/aXXbYYcZZ")).toBe(false);
    expect(match("/a*b*c", "/aXXc")).toBe(false);
  });

  it("途中の $ は literal として扱う(特別なのは終端のみ)", () => {
    expect(match("/pri$ce", "/pri$ce/x")).toBe(true);
    expect(match("/pri$ce", "/price")).toBe(false);
  });

  it("regex metacharacter を含む pattern を literal として扱う(regex注入にならない)", () => {
    expect(match("/a.b", "/a.b")).toBe(true);
    expect(match("/a.b", "/axb")).toBe(false);
    expect(match("/(a)+", "/(a)+x")).toBe(true);
    expect(match("/[a-z]", "/[a-z]")).toBe(true);
    expect(match("/[a-z]", "/q")).toBe(false);
  });

  it("path として解釈できない値は null(compile失敗)", () => {
    expect(compilePathRule("private")).toBeNull();
    expect(compilePathRule("http://example.com/x")).toBeNull();
  });
});

describe("isAllowedByRobots: ワイルドカードで fail-open しない", () => {
  it("Disallow: /* は全pathを拒否する", () => {
    const body = "User-agent: *\nDisallow: /*";
    expect(allows(body, "/")).toBe(false);
    expect(allows(body, "/menu")).toBe(false);
    expect(allows(body, "/a/b/c")).toBe(false);
  });

  it("Disallow: /private/* は配下を拒否する", () => {
    const body = "User-agent: *\nDisallow: /private/*";
    expect(allows(body, "/private/a")).toBe(false);
    expect(allows(body, "/public/a")).toBe(true);
  });

  it("Disallow: /*.pdf$ は拡張子一致を拒否する", () => {
    const body = "User-agent: *\nDisallow: /*.pdf$";
    expect(allows(body, "/menu.pdf")).toBe(false);
    expect(allows(body, "/menu.html")).toBe(true);
    // 照合対象は path+query のため、query が付くと $ に一致しない(RFC 9309 / Google spec)
    expect(allows(body, "/menu.pdf?x=1")).toBe(true);
  });

  it("Allow 側のワイルドカードも解釈する", () => {
    const body = "User-agent: *\nDisallow: /docs\nAllow: /docs/*/public";
    expect(allows(body, "/docs/a/public")).toBe(true);
    expect(allows(body, "/docs/a/private")).toBe(false);
  });

  it("ルート全体の禁止(Disallow: /)を正しく適用する", () => {
    const body = "User-agent: *\nDisallow: /";
    expect(allows(body, "/")).toBe(false);
    expect(allows(body, "/anything")).toBe(false);
  });
});

describe("isAllowedByRobots: specificity と Allow 優先", () => {
  it("Disallowに一致しなければ許可", () => {
    expect(allows("User-agent: *\nDisallow: /admin", "/menu")).toBe(true);
  });

  it("Disallowに一致すれば拒否", () => {
    expect(allows("User-agent: *\nDisallow: /admin", "/admin/x")).toBe(false);
  });

  it("同一specificityならAllowが勝つ", () => {
    expect(allows("User-agent: *\nDisallow: /x\nAllow: /x", "/x")).toBe(true);
  });

  it("より長い(specificな)Allowが Disallow を上書きする", () => {
    const body = "User-agent: *\nDisallow: /admin\nAllow: /admin/public";
    expect(allows(body, "/admin/public/page")).toBe(true);
    expect(allows(body, "/admin/private")).toBe(false);
  });

  it("より長い Disallow が短い Allow に勝つ", () => {
    const body = "User-agent: *\nAllow: /a\nDisallow: /a/secret";
    expect(allows(body, "/a/secret/x")).toBe(false);
    expect(allows(body, "/a/other")).toBe(true);
  });
});

describe("parseRobotsTxt: unsupported syntax は fail-closed", () => {
  it("解釈できない Disallow があれば全pathを拒否する(理解不能→許可にしない)", () => {
    const rules = parseRobotsTxt("User-agent: *\nDisallow: not-a-path");
    expect(rules.failClosed).toBe(true);
    expect(rules.unsupportedRules).toEqual([{ field: "disallow", value: "not-a-path" }]);
    expect(evaluateRobots(rules, "/anything")).toBe("unsupported_fail_closed");
    expect(isAllowedByRobots(rules, "/anything")).toBe(false);
  });

  it("解釈できない Allow は fail-closed にしない(無視しても over-block 方向)", () => {
    const rules = parseRobotsTxt("User-agent: *\nAllow: not-a-path\nDisallow: /x");
    expect(rules.failClosed).toBe(false);
    expect(rules.unsupportedRules).toEqual([{ field: "allow", value: "not-a-path" }]);
    expect(isAllowedByRobots(rules, "/y")).toBe(true);
    expect(isAllowedByRobots(rules, "/x")).toBe(false);
  });

  it("正常なrobots.txtでは unsupportedRules が空", () => {
    const rules = parseRobotsTxt("User-agent: *\nDisallow: /a\nAllow: /a/b\nCrawl-delay: 2");
    expect(rules.unsupportedRules).toEqual([]);
    expect(rules.failClosed).toBe(false);
  });
});

describe("parseRobotsTxt: 構文の細部", () => {
  it("空のDisallowは制限なしを意味する", () => {
    const rules = parseRobotsTxt("User-agent: *\nDisallow:");
    expect(rules.disallowRules).toEqual([]);
    expect(isAllowedByRobots(rules, "/anything")).toBe(true);
  });

  it("コメント・空行を無視する", () => {
    const body = `
# comment
User-agent: *

Disallow: /x
# another comment
`;
    expect(allows(body, "/x")).toBe(false);
  });

  it("field名の大文字小文字を無視する", () => {
    expect(allows("USER-AGENT: *\nDISALLOW: /x", "/x")).toBe(false);
  });

  it("行末コメントを値から除去する", () => {
    expect(allows("User-agent: *\nDisallow: /x # secret area", "/x")).toBe(false);
  });

  it("User-agent行より前のruleを無視する", () => {
    const rules = parseRobotsTxt("Disallow: /orphan\nUser-agent: *\nDisallow: /x");
    expect(isAllowedByRobots(rules, "/orphan")).toBe(true);
    expect(isAllowedByRobots(rules, "/x")).toBe(false);
  });

  it("sitemap 等の未知フィールドを無視する", () => {
    const body = "User-agent: *\nSitemap: https://example.com/sitemap.xml\nDisallow: /x";
    expect(allows(body, "/x")).toBe(false);
  });

  it("CRLF / CR 改行を扱える", () => {
    expect(allows("User-agent: *\r\nDisallow: /x", "/x")).toBe(false);
    expect(allows("User-agent: *\rDisallow: /x", "/x")).toBe(false);
  });

  it("空のrobots.txtは制限なし", () => {
    const rules = parseRobotsTxt("");
    expect(rules.failClosed).toBe(false);
    expect(isAllowedByRobots(rules, "/anything")).toBe(true);
  });
});

describe("Crawl-delay", () => {
  it("指定が無ければnull", () => {
    expect(parseRobotsTxt("User-agent: *\nDisallow:").crawlDelayMs).toBeNull();
  });

  it("下限1000msへclampする", () => {
    expect(parseRobotsTxt("User-agent: *\nCrawl-delay: 0.1").crawlDelayMs).toBe(1000);
  });

  it("上限3000msへclampする", () => {
    expect(parseRobotsTxt("User-agent: *\nCrawl-delay: 10").crawlDelayMs).toBe(3000);
  });

  it("範囲内の値はそのまま(秒→ms変換込み)", () => {
    expect(parseRobotsTxt("User-agent: *\nCrawl-delay: 2").crawlDelayMs).toBe(2000);
  });

  it("複数の有効な値があれば最大値(最も保守的)を採る", () => {
    expect(parseRobotsTxt("User-agent: *\nCrawl-delay: 1\nCrawl-delay: 2.5").crawlDelayMs).toBe(2500);
    expect(parseRobotsTxt("User-agent: *\nCrawl-delay: 2.5\nCrawl-delay: 1").crawlDelayMs).toBe(2500);
  });

  it("merge した複数groupに跨る場合も最大値を採る", () => {
    const body = `
User-agent: *
Crawl-delay: 1
Disallow: /a

User-agent: *
Crawl-delay: 2.5
Disallow: /b
`;
    expect(parseRobotsTxt(body).crawlDelayMs).toBe(2500);
  });

  it("malformed / 負値は無視する", () => {
    expect(parseRobotsTxt("User-agent: *\nCrawl-delay: abc").crawlDelayMs).toBeNull();
    expect(parseRobotsTxt("User-agent: *\nCrawl-delay: -5").crawlDelayMs).toBeNull();
    expect(parseRobotsTxt("User-agent: *\nCrawl-delay:").crawlDelayMs).toBeNull();
  });

  it("malformed が混ざっても有効な値は採用する", () => {
    expect(parseRobotsTxt("User-agent: *\nCrawl-delay: abc\nCrawl-delay: 2").crawlDelayMs).toBe(2000);
  });

  it("Crawl-delay は group を分割しない(直後のUser-agent行は同一group)", () => {
    const body = `User-agent: A\nCrawl-delay: 2\nUser-agent: ${UA}\nDisallow: /x`;
    const rules = parseRobotsTxt(body);
    // A と ${UA} が同一 group なので、Crawl-delay も Disallow も両方が我々に適用される
    expect(rules.crawlDelayMs).toBe(2000);
    expect(isAllowedByRobots(rules, "/x")).toBe(false);
  });

  it("Allow/Disallow の後の User-agent 行は新しい group を開始する", () => {
    const body = `User-agent: A\nDisallow: /a-only\nUser-agent: *\nDisallow: /star`;
    const rules = parseRobotsTxt(body);
    expect(isAllowedByRobots(rules, "/a-only")).toBe(true);
    expect(isAllowedByRobots(rules, "/star")).toBe(false);
  });
});

describe("robotsTargetFromUrl", () => {
  it("path + query を返す", () => {
    expect(robotsTargetFromUrl("https://example.com/menu?x=1")).toBe("/menu?x=1");
  });

  it("queryが無ければpathのみ", () => {
    expect(robotsTargetFromUrl("https://example.com/menu")).toBe("/menu");
  });

  it("ルートは /", () => {
    expect(robotsTargetFromUrl("https://example.com")).toBe("/");
  });

  it("fragmentは含めない", () => {
    expect(robotsTargetFromUrl("https://example.com/menu#x")).toBe("/menu");
  });

  it("パース不能ならnull", () => {
    expect(robotsTargetFromUrl("not a url")).toBeNull();
  });
});

describe("bounded matcher: 病的入力でも停止する", () => {
  it("多数の * を含むpatternでも即座に評価できる", () => {
    const pattern = "/" + "*a".repeat(60);
    const rule = compilePathRule(pattern);
    expect(rule).not.toBeNull();
    const target = "/" + "b".repeat(5000);
    const started = Date.now();
    expect(matchesPathRule(rule!, target)).toBe(false);
    expect(Date.now() - started).toBeLessThan(1000);
  });
});
