import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { connection } from "next/server";
import Link from "next/link";
import { DealNewForm } from "./_components/deal-new-form";
import { getStoreCached } from "@/lib/queries/stores";
import { getAllProfiles } from "@/lib/queries/profiles";
import { getCurrentProfile } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "商談を作成" };

interface PageProps {
  searchParams: Promise<{ store?: string }>;
}

export default async function NewDealPage({ searchParams }: PageProps) {
  // build 時 prerender を skip (USE_CACHE_TIMEOUT 対策)。
  await connection();
  const sp = await searchParams;
  if (!sp.store) {
    notFound();
  }
  const [store, profiles, currentProfile] = await Promise.all([
    getStoreCached(sp.store),
    getAllProfiles({ excludePlaceholders: false }),
    getCurrentProfile(),
  ]);
  if (!store) notFound();

  return (
    <div className="space-y-4 max-w-3xl mx-auto">
      <div>
        <Link
          href={`/stores/${store.id}`}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          ← {store.name}
        </Link>
        <h2 className="text-xl md:text-2xl font-bold text-foreground mt-1">
          新規商談
        </h2>
      </div>
      <DealNewForm
        store={store}
        profiles={profiles}
        currentProfileId={currentProfile?.id ?? null}
      />
    </div>
  );
}
