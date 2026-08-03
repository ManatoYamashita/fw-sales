"use client";

/**
 * reviewable item(confirmed/inferred/conflict)1件分のレビューカード
 * (Plan v3.2 §5.3「53項目レビュー」§5.4「conflict項目」)。
 */

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { SourceBadgeList } from "./research-source-badge";
import type {
  ResearchItem,
  ReviewDecision,
  ReviewDecisionType,
  SourceRegistryEntry,
} from "@/types/research-run";

const STATUS_LABELS: Record<string, string> = {
  confirmed: "確認済み",
  inferred: "推定",
  conflict: "競合",
};

const STATUS_TONES: Record<string, "success" | "warning" | "destructive"> = {
  confirmed: "success",
  inferred: "warning",
  conflict: "destructive",
};

/**
 * confirmed維持の根拠由来を表す平易な文言(feat/ai-research-final-trust-boundary)。
 * `research-source-badge.tsx`の✓/⚠/✕(Source Registry単位、本文取得成否)とは別に、
 * ResearchItem単位で「何を根拠にconfirmedとしたか」を区別する。
 */
const EVIDENCE_BASIS_LABELS: Record<string, string> = {
  places: "📍 Google Placesで確認",
  url_context: "✓ ページ本文で確認",
  search_note: "🔎 検索結果情報で確認",
  mixed: "✓🔎 ページ本文+検索結果情報で確認",
};

export interface DecideInput {
  decision: ReviewDecisionType;
  selectedCandidateId?: string;
  editedValue?: string;
}

interface Props {
  item: ResearchItem;
  label: string;
  sourceRegistry: readonly SourceRegistryEntry[];
  decision: ReviewDecision | undefined;
  busy: boolean;
  onDecide: (input: DecideInput) => void;
}

function decisionLabel(decision: ReviewDecision | undefined): string | null {
  if (!decision) return null;
  if (decision.decision === "adopted") return "採用済み";
  if (decision.decision === "rejected") return "却下済み";
  return "スキップ済み";
}

export function ResearchItemCard({ item, label, sourceRegistry, decision, busy, onDecide }: Props) {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(item.value ?? "");

  const decided = decisionLabel(decision);

  return (
    <div className="border border-border rounded-lg p-4 space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-foreground">{label}</span>
        <div className="flex items-center gap-2">
          {decided && (
            <Badge tone="secondary" className="whitespace-nowrap">
              {decided}
            </Badge>
          )}
          <Badge tone={STATUS_TONES[item.status] ?? "secondary"}>{STATUS_LABELS[item.status] ?? item.status}</Badge>
        </div>
      </div>

      {item.status === "inferred" && (
        <p className="text-xs text-warning">⚠ AIによる分析です。断定はできません。</p>
      )}

      {item.status === "conflict" ? (
        <div className="space-y-3">
          <p className="text-xs text-warning">⚠ 情報源間で内容が一致しません</p>
          {(item.candidates ?? []).map((candidate, idx) => (
            <div key={candidate.candidate_id} className="rounded-md bg-muted/40 p-3 space-y-1.5">
              <p className="text-sm text-foreground">
                候補{String.fromCharCode(65 + idx)}: {candidate.value}
              </p>
              <p className="text-xs text-muted-foreground">{candidate.evidence}</p>
              <SourceBadgeList sourceIds={candidate.source_ids} sourceRegistry={sourceRegistry} />
              <div className="pt-1">
                <Button
                  type="button"
                  size="sm"
                  variant={
                    decision?.decision === "adopted" &&
                    decision.selected_candidate_id === candidate.candidate_id
                      ? "primary"
                      : "outline"
                  }
                  disabled={busy}
                  onClick={() => onDecide({ decision: "adopted", selectedCandidateId: candidate.candidate_id })}
                >
                  候補{String.fromCharCode(65 + idx)}を採用
                </Button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-1.5">
          <p className="text-sm text-foreground">現在値: {item.value ?? "未取得"}</p>
          <p className="text-xs text-muted-foreground">{item.evidence}</p>
          {item.confidence !== null && item.confidence !== undefined && (
            <p className="text-xs text-muted-foreground">確信度: {item.confidence}%</p>
          )}
          {item.evidence_basis && (
            <p className="text-xs text-muted-foreground">{EVIDENCE_BASIS_LABELS[item.evidence_basis]}</p>
          )}
          <SourceBadgeList sourceIds={item.source_ids} sourceRegistry={sourceRegistry} />
        </div>
      )}

      {item.warning && <p className="text-xs text-warning">{item.warning}</p>}

      {editing && item.status !== "conflict" && (
        <div className="space-y-1.5 pt-1">
          <Textarea
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            rows={2}
            aria-label={`${label} 編集値`}
          />
          <div className="flex justify-end gap-2">
            <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)} disabled={busy}>
              キャンセル
            </Button>
            <Button
              type="button"
              size="sm"
              variant="primary"
              disabled={busy}
              onClick={() => {
                onDecide({ decision: "adopted", editedValue: editValue });
                setEditing(false);
              }}
            >
              編集内容で採用
            </Button>
          </div>
        </div>
      )}

      {!editing && (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          {item.status !== "conflict" && (
            <Button
              type="button"
              size="sm"
              variant={decision?.decision === "adopted" ? "primary" : "outline"}
              disabled={busy}
              onClick={() => onDecide({ decision: "adopted" })}
            >
              採用
            </Button>
          )}
          <Button
            type="button"
            size="sm"
            variant={decision?.decision === "rejected" ? "destructive" : "outline"}
            disabled={busy}
            onClick={() => onDecide({ decision: "rejected" })}
          >
            却下
          </Button>
          <Button
            type="button"
            size="sm"
            variant={decision?.decision === "skipped" ? "secondary" : "outline"}
            disabled={busy}
            onClick={() => onDecide({ decision: "skipped" })}
          >
            スキップ
          </Button>
          {item.status !== "conflict" && (
            <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => setEditing(true)}>
              編集して採用
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
