import type { Metadata } from "next";
import { StoreNewForm } from "./_components/store-new-form";

export const metadata: Metadata = {
  title: "店舗登録",
};

export default function NewStorePage() {
  return (
    <div className="space-y-4 max-w-4xl mx-auto">
      <div>
        <h2 className="text-xl md:text-2xl font-bold text-foreground">
          店舗を登録
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          食べログ・GoogleマップのURLから自動入力できます。
          必須項目は店舗名のみです。
        </p>
      </div>
      <StoreNewForm />
    </div>
  );
}
