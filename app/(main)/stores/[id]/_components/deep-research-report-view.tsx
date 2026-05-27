"use client";

/**
 * Deep Research レポート表示コンポーネント (deep-research-pipeline spec #43, Task 5.3)
 *
 * 8 カテゴリ × 51 項目を Tabs で切り替えて表示し、各項目に tier (A/B/C) Badge、
 * confidence、source_urls/source_quote、hearing_question を併記する。
 *
 * Tabs プリミティブは Client Component なので本ファイルも Client にする
 * (server-only データ取得は親 RSC `deep-research-section.tsx` で完了済の前提)。
 *
 * 関連: requirements.md §3.1, §3.5, §7.3, design.md §Components and Interfaces /
 *       DeepResearchReportView
 */

import { Tabs, TabsList, TabsTrigger, TabsPanel } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { CATEGORY_LABELS, type CategoryKey } from "@/lib/ai/deep-research/schema";
import type {
  DeepResearchItem,
  DeepResearchReport,
  DifficultyTier,
} from "@/types/deep-research";

interface DeepResearchReportViewProps {
  report: DeepResearchReport;
}

const TIER_META: Record<
  DifficultyTier,
  { label: string; tone: "success" | "warning" | "info" }
> = {
  A: { label: "A 高信頼", tone: "success" },
  B: { label: "B 推定", tone: "warning" },
  C: { label: "C 要ヒアリング", tone: "info" },
};

const CATEGORY_KEYS: readonly CategoryKey[] = [
  "category_1_basic",
  "category_2_owner",
  "category_3_menu",
  "category_4_customer",
  "category_5_marketing",
  "category_6_competitor",
  "category_7_owned_media",
  "category_8_other",
];

export function DeepResearchReportView({
  report,
}: DeepResearchReportViewProps) {
  const generatedAt = formatJstDateTime(report.created_at);
  return (
    <div className="space-y-3">
      <LegendStrip generatedAt={generatedAt} />

      <Tabs defaultValue="category_1_basic" variant="pill">
        <TabsList>
          {CATEGORY_KEYS.map((key) => (
            <TabsTrigger key={key} value={key}>
              <span className="font-medium">
                {shortLabel(CATEGORY_LABELS[key])}
              </span>
              <span className="ml-1 text-muted-foreground">
                ({report[key].length})
              </span>
            </TabsTrigger>
          ))}
        </TabsList>

        {CATEGORY_KEYS.map((key) => (
          <TabsPanel key={key} value={key}>
            <CategoryPanel
              items={report[key]}
              categoryLabel={CATEGORY_LABELS[key]}
            />
          </TabsPanel>
        ))}
      </Tabs>
    </div>
  );
}

function LegendStrip({ generatedAt }: { generatedAt: string }) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
      <span>区分:</span>
      {(["A", "B", "C"] as DifficultyTier[]).map((tier) => (
        <Badge key={tier} tone={TIER_META[tier].tone}>
          {TIER_META[tier].label}
        </Badge>
      ))}
      <span className="ml-auto">最終生成: {generatedAt}</span>
    </div>
  );
}

function CategoryPanel({
  items,
  categoryLabel,
}: {
  items: DeepResearchItem[];
  categoryLabel: string;
}) {
  if (items.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-4">
        「{categoryLabel}」カテゴリの項目はまだありません。
      </p>
    );
  }
  return (
    <div className="space-y-3">
      {items.map((item) => (
        <ItemRow key={item.key} item={item} />
      ))}
    </div>
  );
}

function ItemRow({ item }: { item: DeepResearchItem }) {
  const meta = TIER_META[item.tier];
  return (
    <article className="rounded-md border border-border bg-card p-3 space-y-1.5">
      <header className="flex items-start gap-2 flex-wrap">
        <Badge tone={meta.tone} data-tier={item.tier}>
          {item.tier}
        </Badge>
        <h4 className="font-medium text-sm">{item.label}</h4>
        {item.confidence !== undefined ? (
          <span className="text-xs text-muted-foreground ml-auto">
            confidence: {item.confidence}
            {item.confidence < 50 ? (
              <span className="ml-1 text-warning">要確認</span>
            ) : null}
          </span>
        ) : null}
      </header>

      {item.value ? (
        <p className="text-sm whitespace-pre-wrap break-words">{item.value}</p>
      ) : (
        <p className="text-sm text-muted-foreground italic">未取得</p>
      )}

      {item.tier === "B" && item.source_quote ? (
        <blockquote className="text-xs text-muted-foreground border-l-2 border-border pl-2 italic">
          “{item.source_quote}”
        </blockquote>
      ) : null}

      {item.tier === "B" && item.source_urls && item.source_urls.length > 0 ? (
        <ul className="text-xs space-y-0.5">
          {item.source_urls.slice(0, 5).map((url) => (
            <li key={url}>
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-info hover:underline break-all"
              >
                {url}
              </a>
            </li>
          ))}
        </ul>
      ) : null}

      {item.tier === "C" && item.hearing_question ? (
        <div className="text-xs bg-info-soft text-info rounded-sm px-2 py-1.5">
          <span className="font-medium">店主に聞く:</span> {item.hearing_question}
        </div>
      ) : null}
    </article>
  );
}

function shortLabel(label: string): string {
  // タブのスペース確保のため 6 文字までに短縮
  const trimmed = label.split("・")[0] ?? label;
  return trimmed.slice(0, 8);
}

function formatJstDateTime(isoString: string): string {
  try {
    const d = new Date(isoString);
    if (Number.isNaN(d.getTime())) return isoString;
    return new Intl.DateTimeFormat("ja-JP", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Asia/Tokyo",
    }).format(d);
  } catch {
    return isoString;
  }
}
