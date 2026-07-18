import { notFound, redirect } from "next/navigation";
import { getStoreCached } from "@/lib/queries/stores";

export default async function LegacyNewDealPage({ searchParams }: { searchParams: Promise<{ store?: string }> }) {
  const { store: storeId } = await searchParams;
  if (!storeId) notFound();
  const store = await getStoreCached(storeId);
  if (!store) notFound();
  redirect(`/stores/${store.id}?tab=progress&action=new`);
}
