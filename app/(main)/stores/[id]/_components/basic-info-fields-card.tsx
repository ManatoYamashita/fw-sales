/**
 * 基本情報 50 項目の表示・編集カード (store-basic-info / task 3.2 + 3.3)
 *
 * `basic_info`(jsonb 50 項目)を 8 カテゴリ別アコーディオンで表示する Server Component。
 * 1 カテゴリ内の各項目は `BasicInfoFieldRow` (Client) に委譲し、tier バッジ・確信度・
 * 出典 URL・出典抜粋・取得ソース・未充足の可視化 (R2.2–R2.6) と inline 編集 (R6.1 / R6.2)
 * を提供する。
 *
 * 編集経路: BasicInfoFieldRow → `updateBasicInfoFieldAction` → `mergeBasicInfo(..., "manual")`
 * で `filled_by="manual"` を強制し、以後の自動充填(Places 等)で上書きされないよう保護する。
 *
 * HTML native `<details name="basic-info-category">` で排他アコーディオンを実装 (1 カテゴリ
 * のみ展開)。`<summary>` がボタン役を担い、`aria-expanded` は自動付与されるため JS 不要。
 * 本コンポーネントは Server Component (no `"use client"`)。
 *
 * 関連: design.md §UI / BasicInfoCard, requirements.md §2.2 §2.3 §2.4 §2.5 §2.6 §6.1 §6.2
 */

import { Card } from "@/components/ui/card";
import {
  BASIC_INFO_ITEMS,
  CATEGORY_LABELS,
  type BasicInfoItemDef,
  type CategoryKey,
} from "@/lib/domain/basic-info-items";
import type { BasicInfo, BasicInfoField } from "@/types/basic-info";
import { BasicInfoFieldRow } from "./basic-info-field-row";

// ---- 充足判定ヘルパ (カテゴリ別カウント用) ------------------------------

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
  storeId: string;
  basicInfo: BasicInfo;
}

// ---- メインカード --------------------------------------------------------

export function BasicInfoFieldsCard({
  storeId,
  basicInfo,
}: BasicInfoFieldsCardProps) {
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
          各項目の「編集」ボタンで手動入力できます。手動入力した値は以後の自動充填で上書きされません。
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
                  <BasicInfoFieldRow
                    key={item.key}
                    storeId={storeId}
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
