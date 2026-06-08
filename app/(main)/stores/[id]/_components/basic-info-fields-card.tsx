/**
 * 基本情報 50 項目の read-only 表示カード (store-basic-info / task 3.2, PR1)
 *
 * `basic_info`(jsonb 50 項目)を 8 カテゴリ別アコーディオンで表示する Server Component。
 * tier バッジ・確信度・出典 URL・出典抜粋・取得ソース・未充足を可視化する (R2.2–R2.6)。
 *
 * 移行段階 (Issue 3 解決):
 * - PR1 (本タスク) は read-only。既存スカラー編集 `BasicInfoCard` と並べて配置し、
 *   スカラーと basic_info の二重書き込みを避ける。
 * - PR2 (task 3.3) でこのカードを編集可能化し、手動編集を `mergeBasicInfo(..., "manual")`
 *   経由で永続化する。それまでは表示専用。
 *
 * HTML native `<details name="basic-info-category">` で排他アコーディオンを実装 (1 カテゴリ
 * のみ展開)。`<summary>` がボタン役を担い、`aria-expanded` は自動付与されるため JS 不要。
 * 本コンポーネントは Server Component (no `"use client"`)。
 *
 * 関連: design.md §UI / BasicInfoCard, requirements.md §2.2 §2.3 §2.4 §2.5 §2.6
 */

import { Card } from "@/components/ui/card";
import {
  BASIC_INFO_ITEMS,
  CATEGORY_LABELS,
  type BasicInfoItemDef,
  type CategoryKey,
  type DifficultyTier,
} from "@/lib/domain/basic-info-items";
import type { BasicInfo, BasicInfoField, FillSource } from "@/types/basic-info";

// ---- 表示ラベル / スタイル -----------------------------------------------

const TIER_LABEL: Record<DifficultyTier, string> = {
  A: "高信頼",
  B: "推定",
  C: "ヒアリング必須",
};

const TIER_CLASS: Record<DifficultyTier, string> = {
  A: "bg-emerald-50 text-emerald-700 border-emerald-200",
  B: "bg-amber-50 text-amber-700 border-amber-200",
  C: "bg-rose-50 text-rose-700 border-rose-200",
};

const SOURCE_LABEL: Record<FillSource, string> = {
  places: "エリア検索",
  manual: "手動入力",
};

// ---- 充足判定ヘルパ ------------------------------------------------------

// type predicate にすると `!filled` 分岐で TS が field を `undefined` に narrow しすぎ、
// `field?.hearing_question` で TS2339 になる。boolean 関数のままにし、利用側で
// `filled && field && ...` の二重 narrow を行う。
function isFilled(field: BasicInfoField | undefined): boolean {
  if (!field) return false;
  if (field.value === null) return false;
  if (field.value.trim() === "") return false;
  return true;
}

// カテゴリ別グルーピング (1 回だけ計算)。
const CATEGORY_GROUPS: Record<CategoryKey, BasicInfoItemDef[]> =
  BASIC_INFO_ITEMS.reduce(
    (acc, item) => {
      acc[item.category].push(item);
      return acc;
    },
    {
      category_1_basic: [],
      category_2_owner: [],
      category_3_menu: [],
      category_4_customer: [],
      category_5_marketing: [],
      category_6_competitor: [],
      category_7_owned_media: [],
      category_8_other: [],
    } as Record<CategoryKey, BasicInfoItemDef[]>,
  );

const CATEGORY_KEYS = Object.keys(CATEGORY_LABELS) as CategoryKey[];

// ---- Props ---------------------------------------------------------------

export interface BasicInfoFieldsCardProps {
  basicInfo: BasicInfo;
}

// ---- メインカード --------------------------------------------------------

export function BasicInfoFieldsCard({ basicInfo }: BasicInfoFieldsCardProps) {
  const totalItems = BASIC_INFO_ITEMS.length;
  const totalFilled = BASIC_INFO_ITEMS.reduce(
    (n, item) => (isFilled(basicInfo[item.key]) ? n + 1 : n),
    0,
  );

  return (
    <Card>
      <Card.Header>
        <Card.Title>基本情報詳細({totalItems} 項目)</Card.Title>
        <span
          className="text-xs text-muted-foreground tabular-nums"
          aria-label={`充足 ${totalFilled} / ${totalItems}`}
        >
          {totalFilled} / {totalItems} 充足
        </span>
      </Card.Header>
      <Card.Body className="space-y-2">
        <p className="text-xs text-muted-foreground">
          現段階は表示のみです。手動編集は後続フェーズで対応します。
        </p>
        {CATEGORY_KEYS.map((cat) => {
          const items = CATEGORY_GROUPS[cat];
          const filledInCat = items.reduce(
            (n, item) => (isFilled(basicInfo[item.key]) ? n + 1 : n),
            0,
          );
          return (
            <details
              key={cat}
              name="basic-info-category"
              className="rounded-md border border-border"
            >
              <summary className="cursor-pointer select-none px-3 py-2 text-sm flex items-center gap-2">
                <span className="font-medium text-foreground">
                  {CATEGORY_LABELS[cat]}
                </span>
                <span
                  className="text-xs text-muted-foreground tabular-nums"
                  aria-label={`このカテゴリの充足 ${filledInCat} / ${items.length}`}
                >
                  ({filledInCat} / {items.length})
                </span>
              </summary>
              <ul className="px-3 pb-3 pt-1 space-y-3 list-none">
                {items.map((item) => (
                  <ItemRow
                    key={item.key}
                    def={item}
                    field={basicInfo[item.key]}
                  />
                ))}
              </ul>
            </details>
          );
        })}
      </Card.Body>
    </Card>
  );
}

// ---- 1 項目行 ------------------------------------------------------------

interface ItemRowProps {
  def: BasicInfoItemDef;
  field: BasicInfoField | undefined;
}

function ItemRow({ def, field }: ItemRowProps) {
  const filled = isFilled(field);
  const tier: DifficultyTier = field?.tier ?? def.default_tier;

  return (
    <li className="text-sm">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="font-medium text-foreground">{def.label}</span>
        <span
          className={`text-[10px] px-1.5 py-0.5 rounded border ${TIER_CLASS[tier]}`}
          aria-label={`取得難易度 ${tier} ${TIER_LABEL[tier]}`}
        >
          {tier}・{TIER_LABEL[tier]}
        </span>
        {filled && field && field.filled_by && (
          <span className="text-[10px] text-muted-foreground">
            取得ソース: {SOURCE_LABEL[field.filled_by]}
          </span>
        )}
      </div>

      <div className="mt-0.5">
        {filled && field ? (
          <span className="text-foreground whitespace-pre-wrap break-words">
            {field.value}
          </span>
        ) : (
          <span
            className="text-muted-foreground italic"
            aria-label="未充足"
          >
            — 未充足 —
          </span>
        )}
      </div>

      {/* tier=B のメタ (確信度・出典・抜粋) */}
      {filled && field && field.tier === "B" && (
        <div className="mt-1 text-xs text-muted-foreground space-y-0.5">
          {typeof field.confidence === "number" && (
            <div>確信度: {field.confidence}</div>
          )}
          {field.source_urls && field.source_urls.length > 0 && (
            <div>
              出典 URL:{" "}
              {field.source_urls.map((url, i) => (
                <span key={url}>
                  {i > 0 && " / "}
                  <a
                    href={url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-primary hover:underline break-all"
                  >
                    {url}
                  </a>
                </span>
              ))}
            </div>
          )}
          {field.source_quote && field.source_quote.trim() !== "" && (
            <div className="whitespace-pre-wrap break-words">
              抜粋:「{field.source_quote.trim()}」
            </div>
          )}
        </div>
      )}

      {/* tier=C のヒアリング質問 (未充足時に表示) */}
      {!filled &&
        tier === "C" &&
        field &&
        field.hearing_question &&
        field.hearing_question.trim() !== "" && (
          <div className="mt-1 text-xs text-muted-foreground">
            <span className="font-medium">ヒアリング質問: </span>
            <span className="whitespace-pre-wrap break-words">
              {field.hearing_question.trim()}
            </span>
          </div>
        )}
    </li>
  );
}
