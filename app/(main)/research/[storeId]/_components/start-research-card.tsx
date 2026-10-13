"use client";

import { Sparkles } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

/** 未調査状態の「AI店舗調査」セクション(Plan v3.2 §5.1)。 */
export function StartResearchCard({
  onStart,
  starting,
  unavailableMessage,
}: {
  onStart: () => void;
  starting: boolean;
  /**
   * いまの環境で AI 調査を実行できない理由 (#324)。あればボタンを押せなくし、理由を
   * ボタンの手前に出す。押してから失敗を知らせるのでは、数分待たせたうえで同じ失敗を
   * 繰り返させることになるため。
   */
  unavailableMessage: string | null;
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
        {unavailableMessage !== null && (
          <p id="research-unavailable-reason" className="text-sm text-foreground">
            {unavailableMessage}
          </p>
        )}
        <div className="flex justify-center py-2">
          <Button
            type="button"
            variant="primary"
            size="lg"
            onClick={onStart}
            pending={starting}
            disabled={unavailableMessage !== null}
            aria-describedby={unavailableMessage !== null ? "research-unavailable-reason" : undefined}
          >
            <Sparkles className="h-4 w-4" />
            {starting ? "開始中…" : "AIで店舗を調査"}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground text-center">過去の調査結果はありません。</p>
      </Card.Body>
    </Card>
  );
}
