import { Suspense, type ReactNode } from "react";
import { Sidebar } from "@/components/layout/sidebar";
import { Topbar } from "@/components/layout/topbar";
import { loadNavBadgeCounts } from "@/components/layout/nav-badges";

async function SidebarShell() {
  const counts = await loadNavBadgeCounts();
  return <Sidebar counts={counts} />;
}

function SidebarFallback() {
  return (
    <aside
      className="hidden md:flex w-60 shrink-0 bg-sidebar border-r border-sidebar-border min-h-dvh flex-col"
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
      <div className="flex-1 flex flex-col min-w-0">
        <Suspense fallback={<TopbarFallback />}>
          <Topbar />
        </Suspense>
        <main className="flex-1 px-4 md:px-6 py-6 md:py-8 max-w-screen-2xl 4xl:max-w-screen-4xl mx-auto w-full">
          {children}
        </main>
      </div>
    </div>
  );
}
