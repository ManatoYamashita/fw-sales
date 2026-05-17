/**
 * 商談リマインダー対象クエリ (auth-and-notifications spec, Issue #16)
 *
 * Vercel Cron `/api/cron/deal-reminders` から呼ばれる読み取り専用クエリ。
 *
 * 役割:
 * - JST (`Asia/Tokyo`) 基準で「明日 / 本日」の `YYYY-MM-DD` を計算
 * - `repos.deal.list()` 全件取得後に該当日のみフィルタ
 *   (本リポジトリは内部ツール規模のため、専用 SQL 化せず in-memory フィルタで十分。
 *    deal 件数が増えた場合は `DealRepository.findManyByDate` を追加する)
 * - `assigned_sales_user_id` が NULL の商談は除外 (Req 6.7)
 * - 担当者ごとに集約し、profile.id → Profile を解決した `ReminderBundle[]` を返す
 *
 * 関連: design.md §「deals-due-soon クエリ」, requirements.md §6.1〜6.4, §6.7
 */

import "server-only";
import { repos } from "@/lib/repositories";
import type { Profile } from "@/types/profile";
import type { Deal } from "@/types/deal";
import type {
  DealReminderMode,
  ReminderDealItem,
} from "@/lib/email";

export interface ReminderBundle {
  readonly profile: Profile;
  readonly deals: readonly ReminderDealItem[];
}

/**
 * 引数の `Date` を Asia/Tokyo タイムゾーンで `YYYY-MM-DD` 文字列に整形する。
 * `Intl.DateTimeFormat('en-CA', ...)` は `YYYY-MM-DD` を返す既知の慣習に依拠する。
 */
function jstYmd(date: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/**
 * `YYYY-MM-DD` 文字列に日数を加算 / 減算する。
 * 文字列を一度 UTC Date に変換しているが、入出力共に「タイムゾーン非依存の暦日」
 * として扱うため、JST / UTC のオフセット影響を受けない。
 */
function shiftYmd(ymd: string, days: number): string {
  const parts = ymd.split("-").map(Number);
  const y = parts[0]!;
  const m = parts[1]!;
  const d = parts[2]!;
  const date = new Date(Date.UTC(y, m - 1, d + days));
  return date.toISOString().split("T")[0]!;
}

function targetDateJst(mode: DealReminderMode): string {
  const today = jstYmd();
  return mode === "tomorrow" ? shiftYmd(today, 1) : today;
}

/**
 * JST 基準で `mode` ('tomorrow' / 'today') 該当日の商談を抽出し、
 * 営業担当 (profile.id) ごとに集約した bundle を返す。
 *
 * 該当 0 件 / 担当者 NULL のみの場合は空配列を返し、呼び出し側は早期 return 可能。
 */
export async function getDealsDueSoon(
  mode: DealReminderMode,
): Promise<readonly ReminderBundle[]> {
  const target = targetDateJst(mode);
  const allDeals = await repos.deal.list();
  const targetDeals = allDeals.filter(
    (d) => d.date === target && d.assigned_sales_user_id !== null,
  );
  if (targetDeals.length === 0) return [];

  // 担当者 user_id ごとに deals を集約 (Map 順序 = 最初に登場した user_id 順)
  const byUser = new Map<string, Deal[]>();
  for (const deal of targetDeals) {
    const uid = deal.assigned_sales_user_id;
    if (uid === null) continue; // 上で filter 済だが型ガードで再確認
    const list = byUser.get(uid) ?? [];
    list.push(deal);
    byUser.set(uid, list);
  }

  // 集約された user_id 群を 1 回の findManyByIds で解決 (N+1 回避)
  const userIds = [...byUser.keys()];
  const profiles = await repos.profile.findManyByIds(userIds);
  const profileById = new Map(profiles.map((p) => [p.id, p]));

  const bundles: ReminderBundle[] = [];
  for (const [uid, deals] of byUser.entries()) {
    const profile = profileById.get(uid);
    // FK 制約があるため通常は到達しないが、整合性が崩れた場合は静かにスキップ
    if (!profile) {
      console.warn(
        `[deals-due-soon] profile not found for user_id ${uid}, skipping ${deals.length} deals.`,
      );
      continue;
    }
    const items: ReminderDealItem[] = deals.map((d) => ({
      store_id: d.store_id,
      store_name: d.store_name,
      meeting_type: d.meeting_type,
      proposal: d.proposal,
    }));
    bundles.push({ profile, deals: items });
  }

  return bundles;
}
