import { notFound, redirect } from "next/navigation";
import { getDealCached } from "@/lib/queries/deals";
import { resolveTenantId } from "@/lib/tenant/context";

export default async function LegacyDealPage({ params }: { params: Promise<{ id: string }> }) {
  const tenantId = await resolveTenantId();
  const { id } = await params;
  const deal = await getDealCached(tenantId, id);
  if (!deal) notFound();
  redirect(`/stores/${deal.store_id}?tab=progress&activity=${deal.id}`);
}
