/**
 * stage / channel の正規順序 (`STAGE_IDS` / `CHANNELS`) を単一の真実として
 * 共有する比較関数群。
 *
 * `lib/queries/store-sort.ts` (店舗一覧) と `lib/domain/sales-progress.ts`
 * (営業進捗一覧) の両方から参照される。domain 層が queries 層へ依存する
 * 逆転を避けるため、どちらからも独立したこのモジュールに順序定義を集約する。
 */
import { STAGE_IDS, type StageId } from "@/types/stage";
import { CHANNELS, type Channel } from "@/types/store";

export const STAGE_ORDER: Readonly<Record<string, number>> = Object.fromEntries(
  STAGE_IDS.map((id, i) => [id, i]),
);

export const CHANNEL_ORDER: Readonly<Record<string, number>> = Object.fromEntries(
  CHANNELS.map((c, i) => [c, i]),
);

export function compareStage(a: StageId, b: StageId): number {
  return (STAGE_ORDER[a] ?? STAGE_IDS.length) - (STAGE_ORDER[b] ?? STAGE_IDS.length);
}

export function compareChannel(a: Channel, b: Channel): number {
  return (CHANNEL_ORDER[a] ?? CHANNELS.length) - (CHANNEL_ORDER[b] ?? CHANNELS.length);
}
