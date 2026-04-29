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
    <aside className="hidden md:block w-60 shrink-0 bg-slate-900" aria-hidden />
  );
}

function TopbarFallback() {
  return (
    <header className="sticky top-0 z-20 h-15 bg-white border-b border-slate-200" />
  );
}

export default function MainLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh">
      <Suspense fallback={<SidebarFallback />}>
        <SidebarShell />
      </Suspense>
      <div className="flex-1 flex flex-col min-w-0">
        <Suspense fallback={<TopbarFallback />}>
          <Topbar />
        </Suspense>
        <main className="flex-1 px-4 md:px-6 py-4 md:py-6">{children}</main>
      </div>
    </div>
  );
}
