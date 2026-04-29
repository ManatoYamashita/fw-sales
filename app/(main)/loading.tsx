import { Spinner } from "@/components/ui/spinner";

export default function MainLoading() {
  return (
    <div className="flex items-center justify-center py-24 text-slate-500 gap-2">
      <Spinner className="h-5 w-5" />
      <span className="text-sm">読み込み中…</span>
    </div>
  );
}
