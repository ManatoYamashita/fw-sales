import { Spinner } from "@/components/ui/spinner";

export default function StoreNewLoading() {
  return (
    <div className="flex items-center justify-center py-24 text-muted-foreground gap-2">
      <Spinner size="lg" />
      <span className="text-sm">登録フォームを準備中…</span>
    </div>
  );
}
