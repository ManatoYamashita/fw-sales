"use client";

/**
 * 出典バッジ(Plan v3.2 §5.3): 技術用語(「URL Context」「grounding」等)を出さず、
 * `url_context_status`/`identity_status` を平易な表現に変換して表示する。
 *
 * fix/ai-research-source-identity-integrity(実機smoke事故の修正、FIX7・FIX8・FIX9):
 * `url_context_status==="success"`(=ページ取得に成功した)は「対象店舗のページだった」
 * ことを一切保証しない。バッジの表示・クリック可否は、Stage2の`source_verifications`と
 * StoreIdentityの突合結果(`identity_status`)も踏まえて決定する。表示名も
 * モデル自己申告の`entry.title`ではなくhostnameからdeterministicに導出する
 * (`deriveDisplaySourceName`)。
 */

import { Badge } from "@/components/ui/badge";
import { deriveDisplaySourceName, isSourceLinkClickable } from "@/types/research-run";
import type { SourceRegistryEntry } from "@/types/research-run";

interface BadgeDisplay {
  icon: string;
  label: string;
  tone: "success" | "warning" | "destructive" | "info";
}

/**
 * `url_context_status`/`identity_status`の組み合わせから表示内容を決定する。
 * `identity_status`が未設定(`not_checked`、既存runとの後方互換)の場合は、
 * 本フィールド導入以前の表示(「✓ 内容を確認済み」)を維持する。
 */
export function getBadgeDisplay(entry: SourceRegistryEntry): BadgeDisplay {
  if (entry.url_context_status === "not_attempted") {
    return { icon: "🔎", label: "検索結果情報のみ", tone: "warning" };
  }
  if (entry.url_context_status === "error") {
    return { icon: "✕", label: "ページを確認できませんでした", tone: "destructive" };
  }

  switch (entry.identity_status) {
    case "target_match":
      return { icon: "✓", label: "対象店舗のページを確認", tone: "success" };
    case "competitor_match":
      return { icon: "✓", label: "競合店のページを確認", tone: "info" };
    case "contextual":
      return { icon: "✓", label: "関連ページを確認", tone: "info" };
    case "unrelated":
      return { icon: "✕", label: "対象店舗と無関係でした", tone: "destructive" };
    case "uncertain":
      return { icon: "⚠", label: "ページ取得済み・店舗同定できず", tone: "warning" };
    case undefined:
    default:
      return { icon: "✓", label: "内容を確認済み", tone: "success" };
  }
}

export function SourceBadge({ entry }: { entry: SourceRegistryEntry }) {
  const url = entry.resolved_url ?? entry.grounding_redirect_url;
  const display = getBadgeDisplay(entry);
  const displayName = deriveDisplaySourceName(entry);
  const clickable = isSourceLinkClickable(entry);

  const content = (
    <>
      <Badge tone={display.tone}>
        {display.icon} {display.label}
      </Badge>
      <span className="text-xs text-muted-foreground truncate max-w-[12rem]">{displayName}</span>
    </>
  );

  // fix/ai-research-source-identity-integrity(FIX8): 識別確認が済んでいないURLへ
  // ユーザーが誤って誘導されないよう、未確認の候補URLはクリック不可にする
  // (known_store_data、またはtarget_match/competitor_match/contextualのいずれか)。
  if (!clickable) {
    return (
      <span
        className="inline-flex items-center gap-1.5 cursor-default"
        title={`${displayName}(URLの店舗同定が未確認のためリンクを無効にしています)`}
      >
        {content}
      </span>
    );
  }

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1.5 hover:underline"
      title={displayName}
    >
      {content}
    </a>
  );
}

export function SourceBadgeList({
  sourceIds,
  sourceRegistry,
}: {
  sourceIds: readonly string[];
  sourceRegistry: readonly SourceRegistryEntry[];
}) {
  const entries = sourceIds
    .map((id) => sourceRegistry.find((e) => e.id === id))
    .filter((e): e is SourceRegistryEntry => e !== undefined);

  if (entries.length === 0) {
    return <span className="text-xs text-muted-foreground">出典なし</span>;
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {entries.map((entry) => (
        <SourceBadge key={entry.id} entry={entry} />
      ))}
    </div>
  );
}
