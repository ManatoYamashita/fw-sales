import { Suspense } from "react";
import type { Metadata } from "next";
import { ActionsList, ActionsListSkeleton } from "./_components/actions-list";

export const metadata: Metadata = { title: "営業アクション" };

export default function ActionsPage() {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl md:text-2xl font-bold text-foreground">
          営業アクション
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          DM・テレアポ・反応待ちの店舗から次のアクションを選びます。
        </p>
      </div>
      <Suspense fallback={<ActionsListSkeleton />}>
        <ActionsList />
      </Suspense>
    </div>
  );
}
