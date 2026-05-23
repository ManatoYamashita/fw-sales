import { Suspense, type ReactNode } from "react";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Sidebar } from "@/components/layout/sidebar";
import { Topbar } from "@/components/layout/topbar";
import { loadNavBadgeCounts } from "@/components/layout/nav-badges";
import { getCurrentProfile } from "@/lib/supabase/server";
import { getRecentNotifications } from "@/lib/queries/notification";

async function SidebarShell() {
  // build 時 prerender を skip (USE_CACHE_TIMEOUT 対策)。
  await connection();
  const [counts, profile] = await Promise.all([
    loadNavBadgeCounts(),
    getCurrentProfile(),
  ]);
  return <Sidebar counts={counts} currentProfile={profile} />;
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

function SidebarFallback() {
  return (
    <aside
      className="hidden md:flex md:sticky md:top-0 md:self-start w-60 shrink-0 bg-sidebar border-r border-sidebar-border h-dvh flex-col"
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

export default function MainLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh bg-background text-foreground">
      <Suspense fallback={<SidebarFallback />}>
        <SidebarShell />
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
