import Link from "next/link";
import { FileQuestion } from "lucide-react";

export default function MainNotFound() {
  return (
    <div className="flex flex-col items-center justify-center py-24 px-6 text-center gap-3">
      <FileQuestion className="h-10 w-10 text-muted-foreground/70" aria-hidden />
      <p className="text-base font-semibold text-foreground">
        ページが見つかりませんでした
      </p>
      <p className="text-sm text-muted-foreground max-w-sm">
        URLを再確認するか、ダッシュボードからやり直してください。
      </p>
      <Link
        href="/dashboard"
        className="mt-2 inline-flex h-10 px-4 items-center justify-center rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-secondary transition-colors"
      >
        ダッシュボードへ戻る
      </Link>
    </div>
  );
}
