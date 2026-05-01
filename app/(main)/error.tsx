"use client";

import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function MainError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[main]", error);
  }, [error]);

  return (
    <div className="flex flex-col items-center justify-center py-24 px-6 text-center gap-3">
      <AlertTriangle className="h-10 w-10 text-amber-500" aria-hidden />
      <p className="text-base font-semibold text-foreground">
        エラーが発生しました
      </p>
      <p className="text-sm text-muted-foreground max-w-md">
        {error.message || "予期しないエラーで処理を完了できませんでした。"}
      </p>
      <Button onClick={reset} variant="primary">
        再試行
      </Button>
    </div>
  );
}
