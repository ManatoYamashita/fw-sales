"use server";

/**
 * データ移送 Server Actions (Reset / Clear / Import / Export Snapshot)
 *
 * 役割:
 * - Settings 画面から呼ばれる Reset / Clear / Import / Export のエントリ。
 *   `stores` / `deals` / `handoffs` の 3 entity 全てを DB へ直接適用する
 *   (Req 8.1〜8.5、research-handoff-db-migration §8)。
 *   Issue #110 で旧 `research` テーブルを撤去したため 4 → 3 entity になった。
 *
 * 制約 / 例外:
 * - DB操作はテナントを束縛したdata repositoryへ委譲する (#370)。
 * - 既存の Server Action シグネチャ (`resetToSeedAction()` /
 *   `clearAllAction()` / `importJsonAction(_prev, formData)` /
 *   `getSnapshotForExportAction()`) と戻り値型は無修正で維持する (Req 9.1)。
 * - `next/cache` の `revalidateTag(_, "max")` 失効規約も従前の通り。
 * - Reset / Clear は admin 判定に加え、`ALLOW_DATA_RESET=1` を立てた本番以外の環境で
 *   だけ実行できる (#298、`lib/data-reset-policy.ts`)。Import は upsert で既存データを
 *   消さないため対象外。
 *
 * 関連: requirements.md §8.1–8.6、design.md §「lib/actions/data-actions.ts (修正)」、
 *       research-handoff-db-migration design Flow 4
 */

import { revalidateTag } from "next/cache";
import type { DbSnapshot } from "@/lib/db/snapshot";
import { repos } from "@/lib/repositories";
import { clipForLog } from "@/lib/utils/log-sanitize";
import { CACHE_TAGS } from "@/lib/cache";
import { failure, success, type ActionResult } from "./_helpers";
import { requireSignedIn, requireAdmin } from "./_authz";
import {
  DATA_RESET_DENIED_MESSAGE,
  isDataResetAllowed,
} from "@/lib/data-reset-policy";
import { resolveTenantId } from "@/lib/tenant/context";

/**
 * 全削除系 (reset / clear) の環境ガード (#298)。admin 判定の後に呼ぶ。
 * 許可されない環境では DB に触れず failure を返す。判定の根拠は `lib/data-reset-policy.ts`。
 */
function denyDataResetOutsideAllowedEnv(
  action: string,
  by: string,
): ActionResult<never> | null {
  if (isDataResetAllowed()) return null;
  console.warn("[authz] denied", {
    action,
    email: by,
    vercelEnv: process.env.VERCEL_ENV ?? null,
    reason: "data_reset_disabled",
  });
  return failure(DATA_RESET_DENIED_MESSAGE);
}

function invalidateAll(tenantId: string) {
  for (const tag of [
    CACHE_TAGS.stores(tenantId),
    CACHE_TAGS.deals(tenantId),
    CACHE_TAGS.handoffs(tenantId),
    CACHE_TAGS.stats(tenantId),
    CACHE_TAGS.kpi(tenantId),
    CACHE_TAGS.pipeline(tenantId),
    CACHE_TAGS.actionQueue(tenantId),
  ]) {
    revalidateTag(tag, "max");
  }
}

export async function resetToSeedAction(): Promise<ActionResult> {
  const tenantId = await resolveTenantId();
  const guard = await requireAdmin("data.resetToSeed");
  if (!guard.ok) return guard.denied;
  const envDenied = denyDataResetOutsideAllowedEnv(
    "data.resetToSeed",
    guard.profile.email,
  );
  if (envDenied) return envDenied;
  // 3 entity 全てを DB トランザクション内でリセット
  // (research-handoff-db-migration §8.3, §8.4, §8.5)。
  try {
    await repos.forTenant(tenantId).data.resetToSeed();
  } catch (e) {
    console.error("[data.reset] failed", {
      message: clipForLog(e instanceof Error ? e.message : String(e)),
    });
    return failure("シードデータに戻せませんでした。時間をおいて、もう一度お試しください。");
  }

  invalidateAll(tenantId);
  console.log("[audit] data.resetToSeed", { by: guard.profile.email });
  return success(undefined, "シードデータにリセットしました");
}

export async function clearAllAction(): Promise<ActionResult> {
  const tenantId = await resolveTenantId();
  const guard = await requireAdmin("data.clearAll");
  if (!guard.ok) return guard.denied;
  const envDenied = denyDataResetOutsideAllowedEnv(
    "data.clearAll",
    guard.profile.email,
  );
  if (envDenied) return envDenied;
  // 3 entity 全てを DB トランザクション内で全削除
  // (research-handoff-db-migration §8.4, §8.5)。
  try {
    await repos.forTenant(tenantId).data.clear();
  } catch (e) {
    console.error("[data.clear] failed", {
      message: clipForLog(e instanceof Error ? e.message : String(e)),
    });
    return failure("データを削除できませんでした。時間をおいて、もう一度お試しください。");
  }

  invalidateAll(tenantId);
  console.log("[audit] data.clearAll", { by: guard.profile.email });
  return success(undefined, "全データを削除しました");
}

export async function importJsonAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const tenantId = await resolveTenantId();
  const guard = await requireAdmin("data.import");
  if (!guard.ok) return guard.denied;
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return failure("ファイルを選択してください");
  }
  try {
    const text = await file.text();
    const parsed = JSON.parse(text);

    const importedStores = Array.isArray(parsed?.stores)
      ? (parsed.stores as DbSnapshot["stores"])
      : undefined;
    const importedDeals = Array.isArray(parsed?.deals)
      ? (parsed.deals as DbSnapshot["deals"])
      : undefined;
    const importedHandoffs = Array.isArray(parsed?.handoffs)
      ? (parsed.handoffs as DbSnapshot["handoffs"])
      : undefined;

    // 3 entity 全てを DB へトランザクション内で upsert
    // (research-handoff-db-migration §8.2, §8.4, §8.5)。
    // Issue #110 で撤去した旧 `research` キーを含む過去のエクスポート JSON も、
    // 各 entity を個別に取り出す下の構造により「読まれずに無視される」形で
    // そのまま受理される (バリデーションで弾かない)。
    if (importedStores || importedDeals || importedHandoffs) {
      await repos.forTenant(tenantId).data.importSnapshot({ stores: importedStores, deals: importedDeals, handoffs: importedHandoffs });
    }

    invalidateAll(tenantId);
    console.log("[audit] data.import", { by: guard.profile.email });
    return success(undefined, "インポートに成功しました");
  } catch (e) {
    // JSON の構文エラーも DB のエラーもここに来る。どちらも英語の文なので画面には出さない。
    console.error("[data.import] failed", {
      message: clipForLog(e instanceof Error ? e.message : String(e)),
    });
    return failure(
      "インポートできませんでした。このツールで書き出した JSON ファイルを選んでいるか確認してください。",
    );
  }
}

export async function getSnapshotForExportAction(): Promise<DbSnapshot> {
  const tenantId = await resolveTenantId();
  const denied = await requireSignedIn();
  if (denied) throw new Error("ログインが必要です");
  // 3 entity を DB から並列取得 (Req 8.1, 8.4)。
  const [dbDeals, dbStores, dbHandoffs] = await Promise.all([
    repos.forTenant(tenantId).deal.list(),
    repos.forTenant(tenantId).store.list(),
    repos.forTenant(tenantId).handoff.list(),
  ]);

  return { stores: dbStores, deals: dbDeals, handoffs: dbHandoffs };
}
