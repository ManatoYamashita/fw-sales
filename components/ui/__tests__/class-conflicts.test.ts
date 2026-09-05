import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

type ComponentName = "Button" | "Card.Body" | "Select" | "Skeleton" | "Spinner";

type ClassConflict = {
  component: ComponentName;
  classes: string[];
};

const ROOT = path.resolve(import.meta.dirname, "../../..");

async function collectTsxFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, {
    withFileTypes: true,
  });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectTsxFiles(fullPath)));
    } else if (entry.isFile() && fullPath.endsWith(".tsx")) {
      files.push(fullPath);
    }
  }
  return files;
}

/** JSX の属性内にアロー関数があっても、`>` でタグを途中終了させない。 */
function openingTags(
  source: string,
  component: ComponentName,
): Array<{ text: string; index: number }> {
  const tags: Array<{ text: string; index: number }> = [];
  const marker = `<${component}`;
  let from = 0;

  while (true) {
    const index = source.indexOf(marker, from);
    if (index < 0) break;
    const boundary = source[index + marker.length];
    if (boundary && !/[\s/>]/.test(boundary)) {
      from = index + marker.length;
      continue;
    }

    let quote: '"' | "'" | "`" | null = null;
    let braces = 0;
    let end = index + marker.length;
    for (; end < source.length; end += 1) {
      const char = source[end];
      if (quote) {
        if (char === quote && source[end - 1] !== "\\") quote = null;
        continue;
      }
      if (char === '"' || char === "'" || char === "`") {
        quote = char;
      } else if (char === "{") {
        braces += 1;
      } else if (char === "}") {
        braces = Math.max(0, braces - 1);
      } else if (char === ">" && braces === 0) {
        tags.push({ text: source.slice(index, end + 1), index });
        break;
      }
    }
    from = Math.max(end + 1, index + marker.length);
  }
  return tags;
}

function attribute(tag: string, name: string): string | undefined {
  return new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`).exec(tag)?.[1];
}

function classes(tag: string): string[] {
  return (attribute(tag, "className") ?? "").split(/\s+/).filter(Boolean);
}

function propClasses(tag: string, component: ComponentName): string[] {
  switch (component) {
    case "Button": {
      const sizes: Record<string, string[]> = {
        xs: ["h-7", "px-2", "text-xs"],
        sm: ["h-8", "px-3", "text-sm"],
        md: ["h-9", "px-4", "text-sm"],
        lg: ["h-10", "px-5", "text-sm"],
        xl: ["h-11", "px-6", "text-base"],
      };
      const size = attribute(tag, "size") ?? "md";
      return sizes[size] ?? [];
    }
    case "Card.Body": {
      const padding = attribute(tag, "padding") ?? "default";
      return {
        default: ["px-5", "py-4"],
        compact: ["px-5", "py-1"],
        flush: ["p-0"],
        spacious: ["px-5", "py-8"],
      }[padding] ?? [];
    }
    case "Select": {
      const width = attribute(tag, "width") ?? "full";
      const density = attribute(tag, "density") ?? "default";
      return [
        ...(density === "compact" ? ["h-8", "text-xs"] : ["h-9", "text-sm"]),
        ...(width === "full" ? ["w-full"] : []),
        "text-foreground",
      ];
    }
    case "Skeleton":
      return [attribute(tag, "tone") === "card" ? "bg-card" : "bg-muted"];
    case "Spinner": {
      const size = attribute(tag, "size") ?? "md";
      const tone = attribute(tag, "tone") ?? "muted";
      return [
        ...(size === "sm"
          ? ["h-3", "w-3"]
          : size === "lg"
            ? ["h-5", "w-5"]
            : ["h-4", "w-4"]),
        tone === "primary" ? "text-primary-foreground" : "text-muted-foreground",
      ];
    }
  }
}

export function findClassConflicts(
  tag: string,
  component: ComponentName,
): ClassConflict | null {
  const base = propClasses(tag, component);
  const variant = attribute(tag, "variant") ?? "default";
  const matches = (className: string) => {
    if (className.includes(":")) return false;
    if (component === "Select") {
      return (
        attribute(tag, "width") !== "auto" && /^(h-|w-|text-)/.test(className)
      );
    }
    if (component === "Button") {
      if (/^(h-|px-|text-)/.test(className)) return true;
      if (/^text-/.test(className)) return true;
      if (["ghost", "outline", "link", "destructive-outline"].includes(variant)) {
        return /^bg-|^text-|^border-/.test(className);
      }
    }
    if (component === "Card.Body") return /^(p-|px-|py-|pt-|pb-|pl-|pr-)/.test(className);
    if (component === "Skeleton") return /^bg-/.test(className);
    if (component === "Spinner") return /^(h-|w-|text-)/.test(className);
    return base.includes(className);
  };
  const conflicting = classes(tag).filter(matches);
  return conflicting.length > 0 ? { component, classes: conflicting } : null;
}

async function scanRepository(): Promise<string[]> {
  const files = [
    ...(await collectTsxFiles(path.join(ROOT, "app"))),
    ...(await collectTsxFiles(path.join(ROOT, "components"))),
  ];
  const findings: string[] = [];
  const components: ComponentName[] = ["Button", "Card.Body", "Select", "Skeleton", "Spinner"];
  for (const file of files) {
    const source = await readFile(file, "utf8");
    for (const component of components) {
      for (const tag of openingTags(source, component)) {
        const conflict = findClassConflicts(tag.text, component);
        if (conflict) {
          const line = source.slice(0, tag.index).split("\n").length;
          findings.push(
            `${path.relative(ROOT, file)}:${line} <${component}> ${conflict.classes.join(", ")}`,
          );
        }
      }
    }
  }
  return findings;
}

describe("UI primitive class conflict guard", () => {
  it("リポジトリ内の基底クラスを className で上書きしない", async () => {
    expect(await scanRepository()).toEqual([]);
  });

  it("負け側のクラスを negative control で検知する", () => {
    expect(
      findClassConflicts(
        '<Select width="full" className="w-auto text-muted-foreground/70" />',
        "Select",
      ),
    ).toEqual({
      component: "Select",
      classes: ["w-auto", "text-muted-foreground/70"],
    });
    expect(
      findClassConflicts('<Spinner className="h-3 w-3" />', "Spinner"),
    ).toEqual({ component: "Spinner", classes: ["h-3", "w-3"] });
    expect(
      findClassConflicts('<Card.Body className="p-0" />', "Card.Body"),
    ).toEqual({ component: "Card.Body", classes: ["p-0"] });
    expect(
      findClassConflicts('<Skeleton className="bg-card" />', "Skeleton"),
    ).toEqual({ component: "Skeleton", classes: ["bg-card"] });
    expect(
      findClassConflicts('<Button size="sm" className="h-7 px-2 text-xs" />', "Button"),
    ).toEqual({ component: "Button", classes: ["h-7", "px-2", "text-xs"] });
  });
});
