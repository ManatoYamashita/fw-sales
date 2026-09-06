import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Topbar } from "../topbar";

// Server Action は import しただけで lib/db へ到達するため遮断する。
vi.mock("@/lib/actions/auth-actions", () => ({ signOutAction: vi.fn() }));

vi.mock("next/navigation", () => ({
  usePathname: () => "/stores/new",
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
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

  it("認証済みプロフィールのアバターと表示名をTopbarへ描画する", () => {
    const html = renderToStaticMarkup(
      <Topbar
        currentProfile={{
          id: "user-1",
          email: "user@example.com",
          display_name: "山本元",
          avatar_url: null,
          role: "admin",
          created_at: "2026-01-01",
          updated_at: "2026-01-01",
        }}
      />,
    );

    expect(html).toContain('aria-label="ユーザーメニュー: 山本元"');
    expect(html).toContain("山本元");
    expect(html).toContain("管理者");
  });
});
