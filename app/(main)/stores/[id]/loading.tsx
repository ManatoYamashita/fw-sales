import { Spinner } from "@/components/ui/spinner";

export default function StoreLoading() {
  return (
    <div className="flex items-center justify-center py-24 text-muted-foreground gap-2">
      <Spinner size="lg" /> 店舗情報を読み込み中…
    </div>
  );
}
