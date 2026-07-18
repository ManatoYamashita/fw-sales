/**
 * 営業進捗 (customer-sales-progress-management) のドメインロジック純粋関数群。
 *
 * - DB 層 (`repos`) や `server-only` への依存を持たないため、
 *   Vitest など Node 単体環境でも読み込める (`lib/queries/store-sort.ts` と同規約)。
 * - server 経由のクエリは `lib/queries/sales-progress.ts` 側でキャッシュ済み一覧と
 *   組み合わせて利用する。
 * - Deal.status が商談進捗の単一の真実であり、本モジュールは「店舗ごとの最新商談」を
 *   決定的なルールで導出するだけで、状態の複製・同期は行わない。
 */
import type { Deal, DealStatus } from "@/types/deal";
import type { SortDirection, Store } from "@/types/store";
import type { StageId } from "@/types/stage";
import type { Channel } from "@/types/store";

export type CurrentSalesState =
  | "won"
  | "lost"
  | "estimated"
  | "following"
  | "initial"
  | "appointment"
  | "researched"
  | "unresearched";

export const CURRENT_SALES_STATE_LABELS: Record<CurrentSalesState, string> = {
  won: "受注（契約）",
  lost: "失注（ロスト）",
  estimated: "見積提出",
  following: "継続追客",
  initial: "初回接触",
  appointment: "アポ取得済み",
  researched: "調査済み・未営業",
  unresearched: "未調査・未営業",
};

export const CURRENT_SALES_STATES = Object.keys(
  CURRENT_SALES_STATE_LABELS,
) as CurrentSalesState[];

export function deriveCurrentSalesState(
  store: Pick<Store, "appointment_acquired_date" | "stage">,
  latestDeal: Pick<Deal, "status"> | null,
): CurrentSalesState {
  if (latestDeal?.status === "受注") return "won";
  if (latestDeal?.status === "失注") return "lost";
  if (latestDeal?.status === "見積提出") return "estimated";
  if (latestDeal?.status === "継続追客") return "following";
  if (latestDeal?.status === "初回接触") return "initial";
  if (latestDeal?.status === "アポ取得") return "appointment";
  if (store.appointment_acquired_date) return "appointment";
  if (store.stage === "架電済み") return "initial";
  if (store.stage === "DeepResearch済み" || store.stage === "調査済み") return "researched";
  return "unresearched";
}

export interface CurrentNextAction {
  date: string | null;
  type: import("@/types/deal").NextActionType | null;
  note: string | null;
  source: "deal" | "legacy-store" | "unset";
}

export function deriveCurrentNextAction(store: Pick<Store, "next_action_date" | "next_action_note">, latestDeal: Pick<Deal, "next_action_date" | "next_action_type" | "next_action_note"> | null): CurrentNextAction {
  if (latestDeal && (latestDeal.next_action_date || latestDeal.next_action_type || latestDeal.next_action_note)) {
    return { date: latestDeal.next_action_date, type: latestDeal.next_action_type, note: latestDeal.next_action_note, source: "deal" };
  }
  if (store.next_action_date || store.next_action_note) {
    return { date: store.next_action_date, type: null, note: store.next_action_note, source: "legacy-store" };
  }
  return { date: null, type: null, note: null, source: "unset" };
}

/* ------------------------------------------------------------------ */
/*  次回アクションの緊急度                                              */
/* ------------------------------------------------------------------ */

export type NextActionUrgency = "overdue" | "today" | "upcoming" | "unset";

export const NEXT_ACTION_URGENCIES: readonly NextActionUrgency[] = [
  "overdue",
  "today",
  "upcoming",
  "unset",
];

export const NEXT_ACTION_URGENCY_LABELS: Record<NextActionUrgency, string> = {
  overdue: "期限超過",
  today: "本日",
  upcoming: "予定あり",
  unset: "未設定",
};

const YMD_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * 次回アクション予定日から緊急度を導出する。
 *
 * `YYYY-MM-DD` 同士の文字列比較のみで判定し、`new Date()` によるローカルタイム変換は
 * 行わない (タイムゾーンで日付がずれる事故の防止)。`todayStr` は呼び出し側が
 * `today()` (`lib/utils/date.ts`, UTC 基準) を注入する。
 */
export function getNextActionUrgency(
  nextActionDate: string | null,
  todayStr: string,
): NextActionUrgency {
  if (!nextActionDate || !YMD_PATTERN.test(nextActionDate)) return "unset";
  if (nextActionDate < todayStr) return "overdue";
  if (nextActionDate === todayStr) return "today";
  return "upcoming";
}

/* ------------------------------------------------------------------ */
/*  最新商談の決定                                                      */
/* ------------------------------------------------------------------ */

/**
 * 商談を「新しい順」に並べる決定的な比較関数。
 * 商談日 (`date`) 降順 → `updated_at` 降順 → `id` 降順のタイブレーク。
 * すべて `YYYY-MM-DD` / text の文字列比較で判定する。
 */
export function compareDealsNewestFirst(a: Deal, b: Deal): number {
  const byDate = b.date.localeCompare(a.date);
  if (byDate !== 0) return byDate;
  const byUpdated = b.updated_at.localeCompare(a.updated_at);
  if (byUpdated !== 0) return byUpdated;
  return b.id.localeCompare(a.id);
}

/** 店舗の「最新商談」を `compareDealsNewestFirst` の規則で決定的に選ぶ。 */
export function pickLatestDeal(deals: readonly Deal[]): Deal | null {
  let latest: Deal | null = null;
  for (const deal of deals) {
    if (latest === null || compareDealsNewestFirst(deal, latest) < 0) {
      latest = deal;
    }
  }
  return latest;
}

/* ------------------------------------------------------------------ */
/*  営業進捗行の導出                                                    */
/* ------------------------------------------------------------------ */

export interface SalesProgressRow {
  store: Store;
  /** 営業担当の表示名。未割当 / 解決不能時は null。 */
  salesName: string | null;
  /** アポ取得済みか (`appointment_acquired_date` の有無から導出)。 */
  appointmentAcquired: boolean;
  /** 最新商談。商談が 1 件もない店舗は null (= UI では「商談なし」)。 */
  latestDeal: Deal | null;
  /** 次回アクションの緊急度。 */
  urgency: NextActionUrgency;
  /** 最終商談日 (`YYYY-MM-DD`)。商談がない場合は null。 */
  latestMeetingDate: string | null;
  currentSalesState: CurrentSalesState;
  currentNextAction: CurrentNextAction;
}

/**
 * 全店舗 + 全商談から営業進捗行を組み立てる。
 * 商談ゼロの店舗も必ず 1 行になる (顧客一覧としての網羅性が要件)。
 */
export function buildSalesProgressRows(
  stores: readonly Store[],
  deals: readonly Deal[],
  profilesById: ReadonlyMap<string, string> | undefined,
  todayStr: string,
): SalesProgressRow[] {
  const dealsByStore = new Map<string, Deal[]>();
  for (const deal of deals) {
    const list = dealsByStore.get(deal.store_id);
    if (list) list.push(deal);
    else dealsByStore.set(deal.store_id, [deal]);
  }

  return stores.map((store) => {
    const latestDeal = pickLatestDeal(dealsByStore.get(store.id) ?? []);
    return {
      store,
      salesName: store.assigned_sales_user_id
        ? (profilesById?.get(store.assigned_sales_user_id) ?? null)
        : null,
      appointmentAcquired: store.appointment_acquired_date !== null,
      latestDeal,
      urgency: getNextActionUrgency(deriveCurrentNextAction(store, latestDeal).date, todayStr),
      latestMeetingDate: latestDeal?.date ?? null,
      currentSalesState: deriveCurrentSalesState(store, latestDeal),
      currentNextAction: deriveCurrentNextAction(store, latestDeal),
    };
  });
}

/* ------------------------------------------------------------------ */
/*  フィルタ                                                            */
/* ------------------------------------------------------------------ */

export interface SalesProgressFilter {
  /** フリーテキスト検索 (店舗名 / エリア / 業態 / メモ)。 */
  q?: string;
  /** アポ取得状況。acquired = 取得済み, none = 未取得。 */
  appt?: "acquired" | "none";
  /** 最新商談ステータス。"none" = 商談なし。 */
  deal?: DealStatus | "none";
  /** 営業担当 (profile.id 完全一致)。`StoreFilter.sales` と同規約。 */
  sales?: string;
  /** 次回アクションの緊急度。 */
  next?: NextActionUrgency;
  state?: CurrentSalesState;
  stage?: StageId;
  channel?: Channel;
}

export function applyProgressFilter(
  rows: readonly SalesProgressRow[],
  filter: SalesProgressFilter,
): SalesProgressRow[] {
  const q = filter.q?.trim().toLowerCase();
  return rows.filter((row) => {
    const s = row.store;
    if (filter.appt === "acquired" && !row.appointmentAcquired) return false;
    if (filter.appt === "none" && row.appointmentAcquired) return false;
    if (filter.deal === "none") {
      if (row.latestDeal !== null) return false;
    } else if (filter.deal) {
      if (row.latestDeal?.status !== filter.deal) return false;
    }
    if (filter.sales && s.assigned_sales_user_id !== filter.sales) return false;
    if (filter.next && row.urgency !== filter.next) return false;
    if (filter.state && row.currentSalesState !== filter.state) return false;
    if (filter.stage && s.stage !== filter.stage) return false;
    if (filter.channel && s.channel !== filter.channel) return false;
    if (q) {
      // applyStoreFilter と同じ対象 + 次回アクション内容も検索できるようにする
      const haystack = [
        s.name,
        s.city,
        s.prefecture,
        s.address,
        s.genre,
        s.memo,
        s.next_action_note ?? "",
      ]
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });
}

/* ------------------------------------------------------------------ */
/*  ソート                                                              */
/* ------------------------------------------------------------------ */

export type ProgressSortKey = "next" | "name" | "appt" | "meeting" | "updated" | "location" | "genre" | "review" | "stage" | "channel" | "sales";

export interface ProgressSort {
  key: ProgressSortKey;
  dir: SortDirection;
}

export const PROGRESS_SORT_KEYS: readonly ProgressSortKey[] = [
  "next",
  "name",
  "appt",
  "meeting",
  "updated",
  "location",
  "genre",
  "review",
  "stage",
  "channel",
  "sales",
];

export const DEFAULT_PROGRESS_SORT: ProgressSort = { key: "next", dir: "asc" };

const NAME_COLLATOR = new Intl.Collator("ja", {
  sensitivity: "base",
  numeric: true,
});

/**
 * 営業進捗行のソート。`applyStoreSort` と同じ安定化規約
 * (同点は更新日新しい順 → 店舗名 → id)。
 * 日付キー (next / appt / meeting) の null (未設定) は方向に関わらず常に末尾固定
 * (sales ソートの null 末尾固定と同規約)。
 */
export function applyProgressSort(
  rows: readonly SalesProgressRow[],
  sort: ProgressSort = DEFAULT_PROGRESS_SORT,
): SalesProgressRow[] {
  const sign = sort.dir === "asc" ? 1 : -1;
  const sorted = [...rows];

  const dateOf = (row: SalesProgressRow): string | null => {
    switch (sort.key) {
      case "next":
        return row.currentNextAction.date;
      case "appt":
        return row.store.appointment_acquired_date;
      case "meeting":
        return row.latestMeetingDate;
      default:
        return null;
    }
  };

  sorted.sort((a, b) => {
    if (sort.key === "next" || sort.key === "appt" || sort.key === "meeting") {
      const ad = dateOf(a);
      const bd = dateOf(b);
      if (ad === null && bd === null) {
        // ↓ tie-breaker へフォールスルー
      } else if (ad === null) {
        return 1;
      } else if (bd === null) {
        return -1;
      } else {
        const d = ad.localeCompare(bd);
        if (d !== 0) return d * sign;
      }
    } else {
      let diff = 0;
      switch (sort.key) {
        case "name":
          diff = NAME_COLLATOR.compare(a.store.name, b.store.name);
          break;
        case "location":
          diff = NAME_COLLATOR.compare(`${a.store.prefecture}${a.store.city}`, `${b.store.prefecture}${b.store.city}`);
          break;
        case "genre":
          diff = NAME_COLLATOR.compare(a.store.genre, b.store.genre);
          break;
        case "review":
          diff = a.store.review_avg - b.store.review_avg || a.store.review_count - b.store.review_count;
          break;
        case "stage":
          diff = a.store.stage.localeCompare(b.store.stage);
          break;
        case "channel":
          diff = a.store.channel.localeCompare(b.store.channel);
          break;
        case "sales":
          if (a.salesName === null && b.salesName !== null) return 1;
          if (a.salesName !== null && b.salesName === null) return -1;
          diff = NAME_COLLATOR.compare(a.salesName ?? "", b.salesName ?? "");
          break;
        case "updated":
        default:
          diff = a.store.updated_at.localeCompare(b.store.updated_at);
          break;
      }
      if (diff !== 0) return diff * sign;
    }
    // 安定化: 同点は更新日新しい順 → 店舗名 → id (applyStoreSort と同規約)
    const u = b.store.updated_at.localeCompare(a.store.updated_at);
    if (u !== 0) return u;
    const n = NAME_COLLATOR.compare(a.store.name, b.store.name);
    if (n !== 0) return n;
    return a.store.id.localeCompare(b.store.id);
  });
  return sorted;
}

const LEGACY_PROGRESS_QUERY_KEYS = ["q", "appt", "deal", "sales", "next", "sort", "dir"] as const;

export function buildLegacyProgressRedirect(
  source: Readonly<Record<string, string | string[] | undefined>>,
): string {
  const target = new URLSearchParams();
  for (const key of LEGACY_PROGRESS_QUERY_KEYS) {
    const value = source[key];
    if (typeof value === "string" && value) target.set(key, value);
  }
  const query = target.toString();
  return query ? `/stores?${query}` : "/stores";
}
