/**
 * 店舗一覧のフィルタ/ソートを担う純粋関数群。
 *
 * - DB 層 (`repos`) や `server-only` への依存を持たないため、
 *   Vitest や Storybook など Node 単体環境でも読み込める。
 * - server 経由のクエリは `lib/queries/stores.ts` 側で `listAllStoresCached()` と
 *   組み合わせて利用する。
 */
import {
  CHANNELS,
  DEFAULT_STORE_SORT,
  type Store,
  type StoreFilter,
  type StoreSort,
} from "@/types/store";
import { STAGE_IDS } from "@/types/stage";

/**
 * `applyStoreSort` 用の補助コンテキスト。
 * 営業担当 (sales) ソート時、profile id → display_name の引きが必要。
 * 未指定時は `sales` ソートを `name` ソートにフォールバックする。
 */
export interface StoreSortContext {
  profilesById?: ReadonlyMap<string, string>;
}

const NAME_COLLATOR = new Intl.Collator("ja", {
  sensitivity: "base",
  numeric: true,
});

const STAGE_ORDER: Record<string, number> = Object.fromEntries(
  STAGE_IDS.map((id, i) => [id, i]),
);

const CHANNEL_ORDER: Record<string, number> = Object.fromEntries(
  CHANNELS.map((c, i) => [c, i]),
);

function locationKey(s: Store): string {
  return `${s.prefecture ?? ""}${s.city ?? ""}`;
}

function resolveSalesName(
  s: Store,
  profilesById: ReadonlyMap<string, string> | undefined,
): string | null {
  if (!s.assigned_sales_user_id) return null;
  return profilesById?.get(s.assigned_sales_user_id) ?? null;
}

export function applyStoreFilter(
  stores: readonly Store[],
  filter: StoreFilter,
): Store[] {
  const q = filter.q?.trim().toLowerCase();
  return stores.filter((s) => {
    if (filter.stage && s.stage !== filter.stage) return false;
    if (filter.channel && s.channel !== filter.channel) return false;
    if (q) {
      const haystack = [
        s.name,
        s.city,
        s.prefecture,
        s.address,
        s.genre,
        s.memo,
      ]
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });
}

export function applyStoreSort(
  stores: readonly Store[],
  sort: StoreSort = DEFAULT_STORE_SORT,
  ctx: StoreSortContext = {},
): Store[] {
  const effectiveKey: StoreSort["key"] =
    sort.key === "sales" && !ctx.profilesById ? "name" : sort.key;
  const sign = sort.dir === "asc" ? 1 : -1;
  const rows = [...stores];

  rows.sort((a, b) => {
    // sales: null/未割当は方向に関わらず常に末尾固定
    if (effectiveKey === "sales") {
      const an = resolveSalesName(a, ctx.profilesById);
      const bn = resolveSalesName(b, ctx.profilesById);
      if (an === null && bn === null) {
        // ↓ tie-breaker へフォールスルー
      } else if (an === null) {
        return 1;
      } else if (bn === null) {
        return -1;
      } else {
        const d = NAME_COLLATOR.compare(an, bn);
        if (d !== 0) return d * sign;
      }
    } else {
      let diff = 0;
      switch (effectiveKey) {
        case "name":
          diff = NAME_COLLATOR.compare(a.name, b.name);
          break;
        case "location":
          diff = NAME_COLLATOR.compare(locationKey(a), locationKey(b));
          break;
        case "genre":
          diff = NAME_COLLATOR.compare(a.genre ?? "", b.genre ?? "");
          break;
        case "review":
          diff = (a.review_avg ?? 0) - (b.review_avg ?? 0);
          if (diff === 0) {
            diff = (a.review_count ?? 0) - (b.review_count ?? 0);
          }
          break;
        case "stage":
          diff =
            (STAGE_ORDER[a.stage] ?? STAGE_IDS.length) -
            (STAGE_ORDER[b.stage] ?? STAGE_IDS.length);
          break;
        case "channel":
          diff =
            (CHANNEL_ORDER[a.channel] ?? CHANNELS.length) -
            (CHANNEL_ORDER[b.channel] ?? CHANNELS.length);
          break;
        case "updated":
        default:
          diff = a.updated_at.localeCompare(b.updated_at);
          break;
      }
      if (diff !== 0) return diff * sign;
    }
    // 安定化: 同点は更新日新しい順 → 名前 → id
    const u = b.updated_at.localeCompare(a.updated_at);
    if (u !== 0) return u;
    const n = NAME_COLLATOR.compare(a.name, b.name);
    if (n !== 0) return n;
    return a.id.localeCompare(b.id);
  });
  return rows;
}
