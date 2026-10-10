"use client";

/**
 * reviewable item(confirmed/inferred/conflict)1件分のレビューカード
 * (Plan v3.2 §5.3「53項目レビュー」§5.4「conflict項目」)。
 *
 * ## いまの値と調査の値を分けて見せる (#319)
 *
 * 旧カードは調査の値を「現在値:」と表示しており、採用するといま入っている基本情報の
 * どれが書き換わるかが画面から分からなかった。いまの値と比べた結果(新規 / 変更なし / 上書き)を
 * バッジで示し、上書きになるときは「いまの値 → 調査の値」を並べる。
 *
 * ## 折りたたみ (#301)
 *
 * 53 項目を全部開いた画面は本番で約 14,600px あった。主ボタンでまとめて採用する項目と
 * 判断済みの項目は 1 行に畳み、1 件ずつ確認する項目と候補を選ぶ項目だけを開いておく。
 */

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { SourceBadgeList } from "./research-source-badge";
import {
  ADOPTION_EFFECT_LABELS,
  BASIC_INFO_ORIGIN_LABELS,
  classifyAdoptionEffect,
  describeBasicInfoOrigin,
  type AdoptionEffect,
} from "@/lib/domain/research-review";
import type { BasicInfoField } from "@/types/basic-info";
import {
  deriveItemTrust,
  getVisibleItemNotes,
  ITEM_TRUST_LABELS,
  stripLegacyEvidenceSupplement,
  type ItemTrust,
} from "@/lib/domain/research-item-notes";
import type {
  ResearchItem,
  ReviewDecision,
  ReviewDecisionType,
  SourceRegistryEntry,
} from "@/types/research-run";

/**
 * バッジの色。文言は `ITEM_TRUST_LABELS`(`lib/domain/research-item-notes.ts`)。
 *
 * 見せ方は `item.status` ではなく `deriveItemTrust` で決める (#301)。status だけで
 * 「確認済み」と出すと、登録済みの値を折り返しただけの項目や、AI が不一致の注記を付けた
 * 項目で、バッジと注記が矛盾して見えていた。
 */
const TRUST_TONES: Record<ItemTrust, "success" | "warning" | "destructive" | "info"> = {
  registered: "info",
  noted: "warning",
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
  // feat/ai-research-quality-ux-hardening(Plan §7.3): canonical fallback。
  // **「今回確認した」とは書かない。** 登録済みの既知情報であることを明示し、
  // fresh(places / url_context / search_note)と視覚的に区別する。
  existing_canonical: "🗂 登録済み情報(今回のWeb再確認なし)",
};

export interface DecideInput {
  decision: ReviewDecisionType;
  selectedCandidateId?: string;
  editedValue?: string;
}

const EFFECT_TONES: Record<AdoptionEffect["kind"], "secondary" | "info" | "warning"> = {
  new: "info",
  same: "secondary",
  overwrite: "warning",
};

interface Props {
  item: ResearchItem;
  label: string;
  sourceRegistry: readonly SourceRegistryEntry[];
  decision: ReviewDecision | undefined;
  busy: boolean;
  onDecide: (input: DecideInput) => void;
  /** いま店舗に入っている基本情報の値。調査の値と比べて、採用した場合の結果を示す。 */
  current: BasicInfoField | undefined;
  /** 初期状態で開いておくか。1 件ずつ確認する項目と候補を選ぶ項目だけを開く。 */
  defaultOpen: boolean;
  /**
   * このカードへ画面内ジャンプするための安定した DOM anchor
   * (`researchItemAnchorId(item.key)`)。
   *
   * 未指定なら anchor を付けない。指定時は `tabIndex={-1}` も併せて付与し、
   * `scrollIntoView` 後に `focus()` できる = キーボード利用者もジャンプ先から操作を継続できる。
   * `scroll-mt-24` は sticky なページヘッダにジャンプ先が隠れないための余白。
   * カード自体が `<details>` なので、`scrollToResearchItem` は閉じたカードも開いてから移動する。
   */
  anchorId?: string;
}

function decisionLabel(
  decision: ReviewDecision | undefined,
  effect: AdoptionEffect | null,
): string | null {
  if (!decision) return null;
  if (decision.decision === "adopted") return "採用済み";
  if (decision.decision === "rejected") {
    return effect?.kind === "overwrite" ? "いまの値を残した" : "却下済み";
  }
  return "スキップ済み";
}

function CurrentValueLine({ current }: { current: BasicInfoField }) {
  return (
    <p className="text-sm text-muted-foreground">
      いまの値（{BASIC_INFO_ORIGIN_LABELS[describeBasicInfoOrigin(current)]}）: {current.value}
    </p>
  );
}

export function ResearchItemCard({
  item,
  label,
  sourceRegistry,
  decision,
  busy,
  onDecide,
  current,
  defaultOpen,
  anchorId,
}: Props) {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(item.value ?? "");

  const isConflict = item.status === "conflict";
  const effect =
    !isConflict && item.value !== null ? classifyAdoptionEffect(current, item.value) : null;
  const hasCurrentValue = current?.value != null && current.value.trim() !== "";
  const decided = decisionLabel(decision, effect);
  const trust = deriveItemTrust(item);
  // Places の値の差の注記は、下の「いまの値 → 調査の値」と同じことを言うので出さない。
  const notes = getVisibleItemNotes(item.warning).filter((note) => note.kind !== "places_diff");
  const isOverwrite = effect?.kind === "overwrite";

  const preview = isConflict
    ? `候補 ${(item.candidates ?? []).length} 件`
    : (item.value ?? "未取得");

  return (
    <details
      id={anchorId}
      tabIndex={anchorId === undefined ? undefined : -1}
      open={defaultOpen}
      className="group border border-border rounded-lg scroll-mt-24 [overflow-wrap:anywhere] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <summary className="flex cursor-pointer select-none flex-wrap items-center gap-2 px-4 py-3 [&>*+*]:ml-auto">
        <span className="flex min-w-0 flex-col">
          <span className="text-sm font-medium text-foreground">{label}</span>
          {/* 閉じているときだけ値を 1 行で見せる。開いたら本文の「調査の値」と重なるので隠す。 */}
          <span className="line-clamp-1 text-xs text-muted-foreground group-open:hidden">{preview}</span>
        </span>
        <span className="flex flex-wrap items-center gap-2">
          {decided && (
            <Badge tone="secondary" className="whitespace-nowrap">
              {decided}
            </Badge>
          )}
          {effect !== null && (
            <Badge tone={EFFECT_TONES[effect.kind]}>{ADOPTION_EFFECT_LABELS[effect.kind]}</Badge>
          )}
          {trust !== null && <Badge tone={TRUST_TONES[trust]}>{ITEM_TRUST_LABELS[trust]}</Badge>}
        </span>
      </summary>

      <div className="space-y-2.5 px-4 pb-4">
        {item.status === "inferred" && (
          <p className="text-xs text-warning">⚠ AIによる分析です。断定はできません。</p>
        )}

        {isConflict ? (
          <div className="space-y-3">
            <p className="text-xs text-warning">⚠ 情報源間で内容が一致しません</p>
            {current && hasCurrentValue && <CurrentValueLine current={current} />}
            {(item.candidates ?? []).map((candidate, idx) => {
              const candidateEffect = classifyAdoptionEffect(current, candidate.value);
              return (
                <div key={candidate.candidate_id} className="rounded-md bg-muted/40 p-3 space-y-1.5">
                  <p className="flex flex-wrap items-center gap-2 text-sm text-foreground">
                    <span>
                      候補{String.fromCharCode(65 + idx)}: {candidate.value}
                    </span>
                    <Badge tone={EFFECT_TONES[candidateEffect.kind]}>
                      {ADOPTION_EFFECT_LABELS[candidateEffect.kind]}
                    </Badge>
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
              );
            })}
          </div>
        ) : (
          <div className="space-y-1.5">
            {isOverwrite && current && <CurrentValueLine current={current} />}
            <p className="text-sm text-foreground">調査の値: {item.value ?? "未取得"}</p>
            {effect?.kind === "same" && (
              <p className="text-xs text-muted-foreground">
                いまの値と同じです。採用しても基本情報は変わりません。
              </p>
            )}
            <p className="text-xs text-muted-foreground">{stripLegacyEvidenceSupplement(item.evidence)}</p>
            {item.confidence !== null && item.confidence !== undefined && (
              <p className="text-xs text-muted-foreground">確信度: {item.confidence}%</p>
            )}
            {item.evidence_basis && (
              <p className="text-xs text-muted-foreground">{EVIDENCE_BASIS_LABELS[item.evidence_basis]}</p>
            )}
            <SourceBadgeList
              sourceIds={item.source_ids}
              sourceRegistry={sourceRegistry}
              evidenceBasis={item.evidence_basis}
            />
          </div>
        )}

        {notes.map((note) => (
          <p key={note.text} className="text-xs text-warning">
            {note.text}
          </p>
        ))}

        {editing && !isConflict && (
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
          // 実運用の頻度順に並べる(採用 → 編集して採用 → 却下 → スキップ)。
          // 上書きになる項目では、採用は「上書きする」、却下は「いまの値を残す」と言い換え、
          // 押した結果が基本情報にどう効くかをボタン自体で示す (#319)。
          <div className="flex flex-wrap items-center gap-2 pt-1">
            {!isConflict && (
              <Button
                type="button"
                size="sm"
                variant={decision?.decision === "adopted" ? "primary" : "outline"}
                disabled={busy}
                onClick={() => onDecide({ decision: "adopted" })}
              >
                {isOverwrite ? "上書きする" : "採用"}
              </Button>
            )}
            {!isConflict && (
              <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => setEditing(true)}>
                編集して採用
              </Button>
            )}
            <Button
              type="button"
              size="sm"
              variant={decision?.decision === "rejected" ? "destructive" : "outline"}
              disabled={busy}
              onClick={() => onDecide({ decision: "rejected" })}
            >
              {isOverwrite ? "いまの値を残す" : "却下"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant={decision?.decision === "skipped" ? "secondary" : "ghost"}
              disabled={busy}
              onClick={() => onDecide({ decision: "skipped" })}
            >
              スキップ
            </Button>
          </div>
        )}
      </div>
    </details>
  );
}
