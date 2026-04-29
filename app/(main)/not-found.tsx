import Link from "next/link";
import { FileQuestion } from "lucide-react";

export default function MainNotFound() {
  return (
    <div className="flex flex-col items-center justify-center py-24 px-6 text-center gap-3">
      <FileQuestion className="h-10 w-10 text-slate-400" aria-hidden />
      <p className="text-base font-semibold text-slate-800">
        ページが見つかりませんでした
      </p>
      <p className="text-sm text-slate-500 max-w-sm">
        URLを再確認するか、ダッシュボードからやり直してください。
      </p>
      <Link
        href="/dashboard"
        className="mt-2 inline-flex h-10 px-4 items-center justify-center rounded-lg bg-slate-900 text-white text-sm font-medium hover:bg-slate-800 transition-colors"
      >
        ダッシュボードへ戻る
      </Link>
    </div>
  );
}
