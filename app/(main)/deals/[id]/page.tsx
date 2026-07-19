import { notFound, redirect } from "next/navigation";
import { getDealCached } from "@/lib/queries/deals";

export default async function LegacyDealPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const deal = await getDealCached(id);
  if (!deal) notFound();
  redirect(`/stores/${deal.store_id}?tab=progress&activity=${deal.id}`);
}
