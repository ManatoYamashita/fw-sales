import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Card } from "../card";
import { Label } from "../label";

const ROOT = path.resolve(import.meta.dirname, "../../..");

async function collectSourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.name === "__tests__") continue;
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectSourceFiles(fullPath)));
    } else if (entry.isFile() && /\.(tsx?|css)$/.test(entry.name)) {
      files.push(fullPath);
    }
  }
  return files;
}

describe("Phase 3 の可読性", () => {
  it("共有カード見出しとラベルは折り返し可能な行間を持つ", () => {
    const html = renderToStaticMarkup(
      <>
        <Card.Title>長いカード見出しが狭い画面でも読みやすく折り返される</Card.Title>
        <Label>長い入力項目ラベル</Label>
      </>,
    );

    expect(html).toContain("leading-snug");
    expect(html).not.toContain("leading-none");
  });

  it("任意の 10px / 11px / 15px 文字サイズを残さない", async () => {
    const files = await collectSourceFiles(path.join(ROOT, "app"));
    files.push(...(await collectSourceFiles(path.join(ROOT, "components"))));
    const sources = await Promise.all(files.map((file) => readFile(file, "utf8")));

    expect(sources.join("\n")).not.toMatch(/text-\[(?:10|11|15)px\]/);
  });
});
