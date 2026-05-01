import Link from "next/link";
import { FileQuestion } from "lucide-react";

export default function StoreNotFound() {
  return (
    <div className="flex flex-col items-center justify-center py-24 px-6 text-center gap-3">
      <FileQuestion className="h-10 w-10 text-muted-foreground/70" aria-hidden />
      <p className="text-base font-semibold text-foreground">
        指定された店舗は見つかりませんでした
      </p>
      <p className="text-sm text-muted-foreground max-w-sm">
        削除された可能性があります。
      </p>
      <Link
        href="/stores"
        className="mt-2 inline-flex h-10 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-medium items-center"
      >
        店舗一覧へ戻る
      </Link>
    </div>
  );
}
