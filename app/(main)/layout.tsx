import { Suspense, type ReactNode } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { cn } from "@/lib/utils/cn";
import { Sidebar } from "@/components/layout/sidebar";
import { Topbar } from "@/components/layout/topbar";
import { loadNavBadgeCounts } from "@/components/layout/nav-badges";
import { getCurrentProfile } from "@/lib/supabase/server";
import { getRecentNotifications } from "@/lib/queries/notification";

async function SidebarShell({
  defaultCollapsed,
}: {
  defaultCollapsed: boolean;
}) {
  // build 時 prerender を skip (USE_CACHE_TIMEOUT 対策)。
  await connection();
  const [counts, profile] = await Promise.all([
    loadNavBadgeCounts(),
    getCurrentProfile(),
  ]);
  return (
    <Sidebar
      counts={counts}
      currentProfile={profile}
      defaultCollapsed={defaultCollapsed}
    />
  );
}

/**
 * Topbar に currentProfile を注入する RSC ラッパ。
 *
 * middleware が `(main)` 配下を保護するため通常はここに到達しているなら
 * 認証済のはずだが、防御的に profile が null の場合は `/login` に redirect する
 * (auth-and-notifications spec §1.1, §1.5)。
 */
async function TopbarShell() {
  await connection();
  const profile = await getCurrentProfile();
  if (!profile) {
    redirect("/login");
  }
  const notifications = await getRecentNotifications(profile.id, 10);
  return <Topbar notifications={notifications} />;
}

function SidebarFallback({ collapsed }: { collapsed: boolean }) {
  return (
    <aside
      className={cn(
        "hidden md:flex md:sticky md:top-0 md:self-start shrink-0 bg-sidebar border-r border-sidebar-border h-dvh flex-col",
        collapsed ? "md:w-16" : "md:w-60",
      )}
      aria-hidden
    >
      <div className="h-15 border-b border-sidebar-border" />
    </aside>
  );
}

function TopbarFallback() {
  return (
    <header
      className="sticky top-0 z-20 h-15 bg-background/80 backdrop-blur-md border-b border-border"
      aria-hidden
    />
  );
}

/**
 * サイドバー枠を担う非同期コンポーネント。
 *
 * `sidebar_collapsed` Cookie は Request-time API のため、Cache Components 下では
 * 必ず `<Suspense>` 配下で読み取る必要がある。レイアウト本体で直接 await すると
 * html/body の静的シェル prerender が丸ごとブロックされ、build が
 * "Uncached data was accessed outside of <Suspense>" で失敗する。
 *
 * Cookie はリクエスト時に即解決するため、実行時はこの内側 Suspense の
 * 正しい幅フォールバックが描画され、折りたたみ状態のちらつきは発生しない。
 * 外側 Suspense の fallback (collapsed=false) は prerender 時の静的シェル用。
 */
async function SidebarSlot() {
  const collapsed = (await cookies()).get("sidebar_collapsed")?.value === "1";
  return (
    <Suspense fallback={<SidebarFallback collapsed={collapsed} />}>
      <SidebarShell defaultCollapsed={collapsed} />
    </Suspense>
  );
}

export default function MainLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-dvh bg-background text-foreground">
      <Suspense fallback={<SidebarFallback collapsed={false} />}>
        <SidebarSlot />
      </Suspense>
      <div className="flex-1 flex flex-col min-w-0 overflow-x-clip">
        <Suspense fallback={<TopbarFallback />}>
          <TopbarShell />
        </Suspense>
        <main className="flex-1 px-4 md:px-6 py-6 md:py-8 max-w-screen-2xl 4xl:max-w-screen-4xl mx-auto w-full">
          {children}
        </main>
      </div>
    </div>
  );
}
