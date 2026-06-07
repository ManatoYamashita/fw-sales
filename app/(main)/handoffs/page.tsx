import type { Metadata } from "next";
import { connection } from "next/server";
import { listHandoffsCached } from "@/lib/queries/handoffs";
import { HandoffsTableView } from "./_components/handoffs-table-view";

export const metadata: Metadata = { title: "引き継ぎ" };

export default async function HandoffsPage() {
  // build 時 prerender を skip (USE_CACHE_TIMEOUT 対策)。
  await connection();
  const handoffs = await listHandoffsCached();
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl md:text-2xl font-bold text-foreground">
          引き継ぎ
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          受注後の運用チームへの引き継ぎを管理します。
        </p>
      </div>
      <HandoffsTableView handoffs={handoffs} />
    </div>
  );
}
