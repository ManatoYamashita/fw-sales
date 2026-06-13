"use client";

import { Copy, ExternalLink } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button, buttonVariants } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils/cn";

/**
 * STEP0: 外部 Gem へ渡す調査プロンプト (店舗の基本情報サマリ) のコピー + Gem 起動。
 * (store-flow-guidance / Issue #122)
 *
 * 貼付・生成 (#121 の単線フロー) の手前に非破壊で前置する。`researchPrompt` は
 * server (`buildBasicInfoBlock`) で算出済みの文字列。`gemUrl` 未設定でもコピーは可能
 * (設定画面への案内を出すのみ)。
 */
export function ResearchPromptStep({
  researchPrompt,
  gemUrl,
}: {
  researchPrompt: string;
  gemUrl: string | null;
}) {
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(researchPrompt);
      toast.success("調査プロンプトをコピーしました");
    } catch {
      toast.error("コピーに失敗しました");
    }
  };

  return (
    <Card>
      <Card.Header>
        <Card.Title>STEP 0 ・ Gem で DeepResearch する</Card.Title>
      </Card.Header>
      <Card.Body className="space-y-3">
        <p className="text-sm text-muted-foreground leading-relaxed">
          店舗の基本情報サマリをコピーし、調査用 Gem に貼り付けて DeepResearch を実行します。
          得られた結果を下の貼付欄に貼って営業資産を生成してください。
        </p>
        <Textarea
          readOnly
          rows={6}
          value={researchPrompt}
          aria-label="調査プロンプト (基本情報サマリ)"
          className="font-mono text-xs"
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="secondary" size="sm" onClick={onCopy}>
            <Copy className="h-3.5 w-3.5" />
            プロンプトをコピー
          </Button>
          {gemUrl ? (
            <a
              href={gemUrl}
              target="_blank"
              rel="noreferrer"
              className={cn(buttonVariants({ variant: "primary", size: "sm" }))}
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Gem を開く
            </a>
          ) : (
            <span className="text-xs text-muted-foreground">
              Gem URL が未設定です（設定画面で登録してください）
            </span>
          )}
        </div>
      </Card.Body>
    </Card>
  );
}
