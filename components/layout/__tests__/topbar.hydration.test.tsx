import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Topbar } from "../topbar";

vi.mock("next/navigation", () => ({
  usePathname: () => "/stores/new",
}));

describe("Topbar SSR (hydration mismatch 確認用)", () => {
  it("mount前は pathname に依存せず安定したHTMLを返す (/stores/new でもbreadcrumbを出さず、Linkボタンになる)", () => {
    const html = renderToStaticMarkup(<Topbar />);

    // useSyncExternalStore はサーバーでは常に false スナップショットを返すため、
    // pathname=/stores/new でも breadcrumb は空、店舗登録ボタンは <a href="/stores/new"> になる。
    expect(html).not.toContain("新規登録");
    expect(html).toContain('href="/stores/new"');
    expect(html).not.toContain("aria-current=\"page\"");
  });
});
