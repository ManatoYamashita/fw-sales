"use client";

import { useState } from "react";
import { Copy, Check } from "lucide-react";
import { toast } from "@/components/ui/toast";

export function CopyButton({ text, label = "コピー" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast.success("コピーしました");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("コピーに失敗しました");
    }
  };
  return (
    <button
      type="button"
      onClick={copy}
      className="inline-flex items-center gap-1 h-8 px-2.5 rounded-md text-xs font-medium border border-border bg-card hover:bg-muted/40 text-foreground"
    >
      {copied ? (
        <>
          <Check className="h-3.5 w-3.5 text-success" />
          コピー済み
        </>
      ) : (
        <>
          <Copy className="h-3.5 w-3.5" />
          {label}
        </>
      )}
    </button>
  );
}
