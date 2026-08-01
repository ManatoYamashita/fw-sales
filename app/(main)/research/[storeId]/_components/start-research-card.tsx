"use client";

import { Sparkles } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

/** 未調査状態の「AI店舗調査」セクション(Plan v3.2 §5.1)。 */
export function StartResearchCard({
  onStart,
  starting,
}: {
  onStart: () => void;
  starting: boolean;
}) {
  return (
    <Card>
      <Card.Header>
        <Card.Title>AI店舗調査</Card.Title>
      </Card.Header>
      <Card.Body className="space-y-3">
        <p className="text-sm text-muted-foreground leading-relaxed">
          Web検索・URLの内容確認を使い、53項目の基本情報を自動調査します(所要3〜5分)。
        </p>
        <div className="flex justify-center py-2">
          <Button type="button" variant="primary" size="lg" onClick={onStart} disabled={starting}>
            <Sparkles className="h-4 w-4" />
            {starting ? "開始中…" : "AIで店舗を調査"}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground text-center">過去の調査結果はありません。</p>
      </Card.Body>
    </Card>
  );
}
