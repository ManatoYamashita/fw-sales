import { notFound } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";
import { HandoffForm } from "./_components/handoff-form";
import { getHandoffCached } from "@/lib/queries/handoffs";

type Params = Promise<{ id: string }>;

export async function generateMetadata({
  params,
}: {
  params: Params;
}): Promise<Metadata> {
  const { id } = await params;
  const handoff = await getHandoffCached(id);
  return { title: handoff ? `${handoff.store_name} 引き継ぎ` : "引き継ぎ" };
}

export default async function HandoffDetailPage({
  params,
}: {
  params: Params;
}) {
  const { id } = await params;
  const handoff = await getHandoffCached(id);
  if (!handoff) notFound();

  return (
    <div className="space-y-4 max-w-4xl mx-auto">
      <div>
        <Link
          href="/handoffs"
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          ← 引き継ぎ一覧
        </Link>
        <h2 className="text-xl md:text-2xl font-bold text-foreground mt-1">
          {handoff.store_name}
        </h2>
        <p className="text-sm text-muted-foreground mt-0.5">
          商談 ID: {handoff.deal_id}
        </p>
      </div>
      <HandoffForm handoff={handoff} />
    </div>
  );
}
