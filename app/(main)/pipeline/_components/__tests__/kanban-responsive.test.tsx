import { load } from "cheerio";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { StoreFilter } from "@/types/store";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: vi.fn(), cacheTag: vi.fn() }));
vi.mock("@/lib/queries/pipeline", () => ({ getPipelineColumns: vi.fn(async () => []) }));
vi.mock("@/lib/queries/profiles", () => ({ getAllProfiles: vi.fn(async () => []) }));

const { KanbanBoard } = await import("../kanban-board");

describe("KanbanBoard の狭幅構造", () => {
  it("横並びへ切り替わっても viewport 側へはみ出す負の余白を持たない", async () => {
    const html = renderToStaticMarkup(await KanbanBoard({ filter: {} as StoreFilter }));
    const $ = load(html);
    const container = $("div").first();
    expect(container.attr("class")?.split(" ")).toContain("@container");
    const scroller = container.children().first();
    expect(scroller.attr("class")).toContain("@min-[700px]:overflow-x-auto");
    expect(scroller.attr("class")).not.toMatch(/(?:^|\s)(?:@[^\s:]+:)?-mx-/);
  });
});
