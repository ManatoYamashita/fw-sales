import { notFound, redirect } from "next/navigation";
import { getStoreCached } from "@/lib/queries/stores";
import { resolveTenantId } from "@/lib/tenant/context";

export default async function LegacyNewDealPage({ searchParams }: { searchParams: Promise<{ store?: string }> }) {
  const tenantId = await resolveTenantId();
  const { store: storeId } = await searchParams;
  if (!storeId) notFound();
  const store = await getStoreCached(tenantId, storeId);
  if (!store) notFound();
  redirect(`/stores/${store.id}?tab=progress&action=new`);
}
