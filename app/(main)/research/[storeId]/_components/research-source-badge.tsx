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

/**
 * `identity_status === "uncertain"` のとき、Stage1 が発見した候補タイトルを
 * **「未確認の検索候補」として**併記してよいか判定する
 * (PR #180 Sparse Store Source Identity Recovery)。
 *
 * ## なぜ必要か
 *
 * `grounding_redirect_url` は transport host(`vertexaisearch.cloud.google.com`)のため
 * `deriveDisplaySourceName` が hostname から媒体名を導出できず、未確認 entry は
 * 「情報源(詳細不明)」としか表示されない。実機 run では 10 source 中 8 件がこの状態で、
 * ユーザーは「AI が何を見て何に失敗したのか」を全く判断できなかった。
 *
 * ## 安全上の制約
 *
 * `entry.title` は **Stage1 モデルが生成した検索結果タイトル**であり、
 * 過去に別店舗の URL へ自店名タイトルが付いていた事故がある。したがって:
 *
 * - `deriveDisplaySourceName` は**変更しない**。「情報源(詳細不明)」はそのまま残す
 * - `isSourceLinkClickable` も**変更しない**。uncertain は引き続きクリック不可
 * - confirmed 判定 / trust matrix / Tier B へ `entry.title` を新しく流さない
 *   (本コンポーネントは表示専用で、`validateResearchItemStatus` からは呼ばれない)
 * - 文言に必ず「検索候補」と「未確認」を含め、確認済みの出典と誤認させない
 */
export function shouldShowCandidateTitle(entry: SourceRegistryEntry): boolean {
  return entry.identity_status === "uncertain" && entry.title.trim() !== "";
}

/** 未確認候補であることを打ち消せないよう、必ず両方の語を含む固定ラベル。 */
const CANDIDATE_TITLE_LABEL = "検索候補(未確認)";

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
    // 未確認 entry でも、Stage1 が拾った候補タイトルを「未確認の検索候補」として併記する。
    // 確認済みの出典名(`displayName`)とは別行・別ラベルで示し、混同させない。
    if (shouldShowCandidateTitle(entry)) {
      return (
        <span
          className="inline-flex flex-col gap-0.5 cursor-default"
          title={`${displayName}(URLの店舗同定が未確認のためリンクを無効にしています)`}
        >
          <span className="inline-flex items-center gap-1.5">{content}</span>
          <span className="text-[11px] text-muted-foreground truncate max-w-[20rem]">
            {CANDIDATE_TITLE_LABEL}: {entry.title}
          </span>
        </span>
      );
    }

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
