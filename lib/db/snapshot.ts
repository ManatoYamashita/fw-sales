import type { Store } from "@/types/store";
import type { Research } from "@/types/research";
import type { Deal } from "@/types/deal";
import type { Handoff } from "@/types/handoff";

/**
 * Export / Import 経路で授受される 4 entity のスナップショット型。
 *
 * `/api/export` (GET) と `lib/actions/data-actions.ts` の
 * `importJsonAction` / `getSnapshotForExportAction` で共有される構造体。
 *
 * 旧 `lib/mock/db.ts` の `DbSnapshot` から移植 (Issue #39, Mock 経路廃止)。
 * `profiles` / `notifications` フィールドは旧実装では optional だったが、
 * export/import 経路への組込が行われないまま dead code 化していたため除去した。
 * 必要になった時点で追加すること。
 */
export interface DbSnapshot {
  stores: Store[];
  research: Research[];
  deals: Deal[];
  handoffs: Handoff[];
}
