import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  WEBSITE_SCANNER_USER_AGENT_PRODUCT,
  WEBSITE_SCANNER_USER_AGENT_HEADER,
  WEBSITE_SCANNER_USER_AGENT_VERSION,
} from "../user-agent";

const WEBSITE_DIR = join(fileURLToPath(new URL(".", import.meta.url)), "..");

function collectTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...collectTsFiles(full));
    } else if (entry.endsWith(".ts")) {
      out.push(full);
    }
  }
  return out;
}

describe("Website Scanner User-Agent", () => {
  it("正式な product token は FirstWebResearchAI", () => {
    expect(WEBSITE_SCANNER_USER_AGENT_PRODUCT).toBe("FirstWebResearchAI");
  });

  it("HEADER は PRODUCT を含んで組み立てられる(手書きしない)", () => {
    expect(WEBSITE_SCANNER_USER_AGENT_HEADER).toContain(WEBSITE_SCANNER_USER_AGENT_PRODUCT);
    expect(WEBSITE_SCANNER_USER_AGENT_HEADER).toContain(
      `${WEBSITE_SCANNER_USER_AGENT_PRODUCT}/${WEBSITE_SCANNER_USER_AGENT_VERSION}`,
    );
    expect(WEBSITE_SCANNER_USER_AGENT_HEADER).toMatch(/^Mozilla\/5\.0 \(compatible; /);
  });

  it("HEADER に typo 綴りが混入しない", () => {
    expect(WEBSITE_SCANNER_USER_AGENT_HEADER).not.toContain("Reserch");
  });

  it("lib/website 配下に typo 綴りが 1 件も存在しない", () => {
    // 本テスト自身が検出対象にならないよう、探索文字列は連結で組み立てる。
    // これにより除外リストが不要になり、スキャンの網羅性に穴が空かない。
    const typo = ["FirstWeb", "Reserch", "AI"].join("");
    const offenders = collectTsFiles(WEBSITE_DIR)
      .filter((file) => readFileSync(file, "utf8").includes(typo))
      .map((file) => file.replace(WEBSITE_DIR, "").replace(/\\/g, "/"));
    expect(offenders).toEqual([]);
  });

  it("lib/website 配下で正式綴りを直書きしているのは user-agent.ts と本テストのみ", () => {
    // robots parser 等が文字列を手書きすると、共有定数を変えても追随しなくなるため。
    const offenders = collectTsFiles(WEBSITE_DIR)
      .filter((file) => readFileSync(file, "utf8").includes("FirstWebResearchAI"))
      .map((file) => file.replace(WEBSITE_DIR, "").replace(/\\/g, "/"))
      .filter((rel) => rel !== "/user-agent.ts" && rel !== "/__tests__/user-agent.test.ts");
    expect(offenders).toEqual([]);
  });
});
