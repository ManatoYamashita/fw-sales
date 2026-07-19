import { redirect } from "next/navigation";
import { buildLegacyProgressRedirect } from "@/lib/domain/sales-progress";

export default async function LegacySalesProgressPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const source = await searchParams;
  redirect(buildLegacyProgressRedirect(source));
}
