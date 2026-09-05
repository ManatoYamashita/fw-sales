import { Spinner } from "@/components/ui/spinner";

export default function MainLoading() {
  return (
    <div className="flex items-center justify-center py-24 text-muted-foreground gap-2">
      <Spinner size="lg" />
      <span className="text-sm">読み込み中…</span>
    </div>
  );
}
