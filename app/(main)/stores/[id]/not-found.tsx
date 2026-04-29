import Link from "next/link";
import { FileQuestion } from "lucide-react";

export default function StoreNotFound() {
  return (
    <div className="flex flex-col items-center justify-center py-24 px-6 text-center gap-3">
      <FileQuestion className="h-10 w-10 text-slate-400" aria-hidden />
      <p className="text-base font-semibold text-slate-800">
        指定された店舗は見つかりませんでした
      </p>
      <p className="text-sm text-slate-500 max-w-sm">
        削除された可能性があります。
      </p>
      <Link
        href="/stores"
        className="mt-2 inline-flex h-10 px-4 rounded-lg bg-slate-900 text-white text-sm font-medium items-center"
      >
        店舗一覧へ戻る
      </Link>
    </div>
  );
}
