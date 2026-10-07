"use client";

import { useEffect, useState } from "react";
import { Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";

/**
 * テキストをクリップボードへコピーするボタン。
 *
 * 押した直後の 2 秒間はラベルとアイコンを「コピー済み」に替え、結果を色だけに頼らず
 * 示す。`target` を渡すと「{target}を」を視覚的に隠して前置し、同じ画面に並ぶ複数の
 * ボタンを支援技術で区別できる (例: 「架電スクリプトをコピー」)。`aria-label` で
 * 名前を上書きしないのは、押下後の表示「コピー済み」と読み上げがずれないようにするため。
 */
export function CopyButton({
  text,
  label = "コピー",
  target,
}: {
  text: string;
  label?: string;
  /** コピー対象の名前。読み上げにだけ使う。 */
  target?: string;
}) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast.success("コピーしました");
    } catch {
      toast.error("コピーに失敗しました");
    }
  };

  return (
    <Button
      type="button"
      variant="outline"
      size="xs"
      gap="tight"
      onClick={copy}
    >
      {target ? <span className="sr-only">{target}を</span> : null}
      {copied ? (
        <>
          <Check className="h-3.5 w-3.5 text-success" aria-hidden />
          コピー済み
        </>
      ) : (
        <>
          <Copy className="h-3.5 w-3.5" aria-hidden />
          {label}
        </>
      )}
    </Button>
  );
}
