import { Spinner } from "@/components/ui/spinner";

export default function StoreLoading() {
  return (
    <div className="flex items-center justify-center py-24 text-muted-foreground gap-2">
      <Spinner className="h-5 w-5" /> 店舗情報を読み込み中…
    </div>
  );
}
