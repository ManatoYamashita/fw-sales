import type { Store } from "@/types/store";
import type { Deal } from "@/types/deal";
import type { Handoff } from "@/types/handoff";

/**
 * Export / Import 経路で授受される 3 entity のスナップショット型。
 *
 * `/api/export` (GET) と `lib/actions/data-actions.ts` の
 * `importJsonAction` / `getSnapshotForExportAction` で共有される構造体。
 *
 * 旧 `lib/mock/db.ts` の `DbSnapshot` から移植 (Issue #39, Mock 経路廃止)。
 * `profiles` / `notifications` フィールドは旧実装では optional だったが、
 * export/import 経路への組込が行われないまま dead code 化していたため除去した。
 * 必要になった時点で追加すること。
 *
 * Issue #110: 旧手入力調査テーブルの撤去に伴い `research` フィールドを削除した。
 * 過去に出力した JSON に残る `research` キーは `importJsonAction` が読まずに
 * 無視するため、旧バックアップのインポートは引き続き成功する。
 */
export interface DbSnapshot {
  stores: Store[];
  deals: Deal[];
  handoffs: Handoff[];
}
