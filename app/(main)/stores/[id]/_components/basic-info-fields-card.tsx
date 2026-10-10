/**
 * 店舗の調査情報カード (店舗詳細の基本情報タブ、#335)
 *
 * `stores.basic_info` の 53 項目を 8 カテゴリに分けて表示し、その場で値を直せるようにする
 * Server Component。各項目は `BasicInfoFieldRow` (Client) が「項目名 / 値 / 信頼度」の
 * 1 行で描く。
 *
 * ## この場所の役割
 *
 * 強み・弱み・架電スクリプトなど営業資産を生成するときの入力。生成結果を表示する場所ではない。
 * 値は次の経路で入る。AI 調査が終わっただけで全項目が埋まるわけではない。
 *
 * - AI 調査の結果をレビューで「採用」した項目 (`buildAdoptedBasicInfoField`)
 * - エリア検索 (Google Places) から登録した店舗の一部項目
 * - このカードでの直接入力 (`updateBasicInfoFieldAction`。以後の自動充填から保護される)
 *
 * カテゴリは native `<details name="basic-info-category">` の排他アコーディオン。
 * 開閉状態は `<summary>` の向きの変わる矢印で示す。未保存の変更を残したまま閉じた
 * カテゴリには、`:has()` で「未保存の変更あり」を出す (入力中の値は閉じても DOM に残る)。
 *
 * 関連: docs/architecture/basic-info-inline-edit.md
 */

import { ChevronRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import {
  BASIC_INFO_ITEMS,
  CATEGORY_LABELS,
  type BasicInfoItemDef,
  type CategoryKey,
} from "@/lib/domain/basic-info-items";
import { BASIC_INFO_TRUST_CRITERIA, hasBasicInfoValue } from "@/lib/domain/basic-info-trust";
import type { BasicInfo } from "@/types/basic-info";
import { BasicInfoFieldRow } from "./basic-info-field-row";
import { TrustBadge } from "./basic-info-trust-badge";

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

export const BASIC_INFO_CARD_TITLE = "店舗の調査情報";

export const BASIC_INFO_CARD_LEAD =
  "AI調査の結果をレビューで採用すると反映されます。ここで直接入力・修正した情報も、営業資産の生成に使われます。";

export interface BasicInfoFieldsCardProps {
  storeId: string;
  basicInfo: BasicInfo;
}

export function BasicInfoFieldsCard({ storeId, basicInfo }: BasicInfoFieldsCardProps) {
  const totalItems = BASIC_INFO_ITEMS.length;
  const totalFilled = BASIC_INFO_ITEMS.filter((item) => hasBasicInfoValue(basicInfo[item.key])).length;

  return (
    <Card>
      <Card.Header>
        <Card.Title>{BASIC_INFO_CARD_TITLE}</Card.Title>
        <span className="text-sm text-muted-foreground tabular-nums">
          {`入力済み ${totalFilled} / ${totalItems}`}
        </span>
      </Card.Header>
      <Card.Body className="space-y-3">
        <p className="text-sm text-muted-foreground">{BASIC_INFO_CARD_LEAD}</p>
        <TrustLegend />
        <div className="space-y-2">
          {CATEGORY_KEYS.map((cat) => {
            const items = CATEGORY_GROUPS[cat];
            const filledInCat = items.filter((item) => hasBasicInfoValue(basicInfo[item.key])).length;
            return (
              <details
                key={cat}
                name="basic-info-category"
                className="group rounded-md border border-border"
              >
                <summary className="flex min-h-11 cursor-pointer select-none items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-muted/40 md:min-h-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <ChevronRight
                    aria-hidden
                    className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90 motion-reduce:transition-none"
                  />
                  {/* 狭い幅では件数・未保存の表示を次の行へ送り、語の途中で折り返さない。 */}
                  <span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    <span className="font-medium text-foreground">{CATEGORY_LABELS[cat]}</span>
                    <span className="whitespace-nowrap text-xs text-muted-foreground tabular-nums">
                      {`入力済み ${filledInCat} / ${items.length}`}
                    </span>
                    <span className="ml-auto hidden whitespace-nowrap text-xs font-medium text-foreground group-has-[[data-unsaved]]:inline">
                      未保存の変更あり
                    </span>
                  </span>
                </summary>
                <ul className="@container list-none divide-y divide-border border-t border-border px-3">
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
        </div>
      </Card.Body>
    </Card>
  );
}

/** 信頼度の色と段階の対応。色の意味を文字でも示す。 */
function TrustLegend() {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
      <span className="font-medium text-foreground">信頼度（AI調査のスコア）</span>
      {(["high", "check", "low"] as const).map((level) => (
        <span key={level} className="inline-flex items-center gap-1">
          <TrustBadge id={`basic-info-legend-${level}`} trust={{ kind: "rated", level, score: 0 }} />
          {BASIC_INFO_TRUST_CRITERIA[level]}
        </span>
      ))}
      <span>未評価: スコアの無い値（直接入力・エリア検索など）</span>
    </div>
  );
}
