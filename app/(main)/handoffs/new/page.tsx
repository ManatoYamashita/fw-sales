import { notFound } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";
import { HandoffNewForm } from "./_components/handoff-new-form";
import { getDealCached } from "@/lib/queries/deals";

export const metadata: Metadata = { title: "引き継ぎを作成" };

interface PageProps {
  searchParams: Promise<{ deal?: string }>;
}

export default async function NewHandoffPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  if (!sp.deal) notFound();
  const deal = await getDealCached(sp.deal);
  if (!deal) notFound();

  return (
    <div className="space-y-4 max-w-4xl mx-auto">
      <div>
        <Link
          href={`/deals/${deal.id}`}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          ← {deal.store_name} の商談
        </Link>
        <h2 className="text-xl md:text-2xl font-bold text-foreground mt-1">
          運用への引き継ぎ
        </h2>
      </div>
      <HandoffNewForm deal={deal} />
    </div>
  );
}
