/**
 * 基本情報の値の信頼度バッジ (#335)
 *
 * 緑「高」・黄「要確認」・赤「低」の 3 段階だけに色を付ける。色だけに頼らないよう、
 * 段階ごとに形の違うアイコンと短い文字を併せて出し、読み上げ名にも段階を入れる。
 *
 * - 未入力: 何も出さない (入力欄の「未入力」の表示で足りる。53 項目に同じ札を並べない)
 * - 未評価 (スコアの無い値): 色を付けず、文字だけで出す
 * - 未保存 (`trust === null`): 入力中の値はまだ判定していないので、保存済みの値の
 *   信頼度を出さずに「未保存」と出す
 *
 * 色は `--trust-*` トークン (app/globals.css) だけを使い、保存などの操作には使わない。
 */

import { CircleCheck, CircleX, TriangleAlert, type LucideIcon } from "lucide-react";
import {
  basicInfoTrustLabel,
  type BasicInfoTrust,
  type BasicInfoTrustLevel,
} from "@/lib/domain/basic-info-trust";
import { cn } from "@/lib/utils/cn";

const LEVEL_CLASSES: Record<BasicInfoTrustLevel, string> = {
  high: "bg-trust-high-soft text-trust-high-on-soft",
  check: "bg-trust-check-soft text-trust-check-on-soft",
  low: "bg-trust-low-soft text-trust-low-on-soft",
};

const LEVEL_ICONS: Record<BasicInfoTrustLevel, LucideIcon> = {
  high: CircleCheck,
  check: TriangleAlert,
  low: CircleX,
};

const BASE = "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium leading-5 whitespace-nowrap";

export function TrustBadge({ id, trust }: { id: string; trust: BasicInfoTrust | null }) {
  if (trust === null) {
    return (
      <span id={id} className={cn(BASE, "border border-dashed border-border text-muted-foreground")}>
        未保存
      </span>
    );
  }
  if (trust.kind === "empty") return null;
  if (trust.kind === "unrated") {
    return (
      <span id={id} className={cn(BASE, "text-muted-foreground")}>
        <span className="sr-only">信頼度 </span>
        {basicInfoTrustLabel(trust)}
      </span>
    );
  }
  const Icon = LEVEL_ICONS[trust.level];
  return (
    <span id={id} className={cn(BASE, LEVEL_CLASSES[trust.level])} data-trust={trust.level}>
      <Icon aria-hidden className="size-3.5 shrink-0" />
      <span className="sr-only">信頼度 </span>
      {basicInfoTrustLabel(trust)}
    </span>
  );
}
