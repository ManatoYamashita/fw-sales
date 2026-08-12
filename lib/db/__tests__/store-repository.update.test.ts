/**
 * `makeStoreRepo(...).update` / `.mergeBasicInfo` の partial UPDATE 検証
 * (feat/ai-research-quality-ux-hardening、最終レビュー指摘1)。
 *
 * ## 何を守るテストか
 *
 * 旧実装は「現在行を SELECT → patch をマージ → **全 Store 列を SET**」という
 * read-modify-write だった。行ロックを取らない `store.update()` writer
 * (`updateStorePatchAction` / `updateStoreStageAction` / `recordActionResultAction` /
 * `generateSalesAssetsAction` / handoff / deal / research 等)が review 系の
 * canonical 更新と並行実行されると、
 *
 *   1. 別 writer が古い Store 行を読む
 *   2. review action が `basic_info` を更新して commit
 *   3. 別 writer が **古い basic_info を含む全列 SET** を行う
 *
 * という lost update が成立していた。行ロックだけでは
 * 「lock を取らない writer」を止められないため、**書き込み範囲そのものを
 * patch 列だけに絞る**ことで構造的に解消する。
 *
 * したがって本テストの本質は「SET payload に patch 外の列が含まれないこと」。
 */

import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/client", () => ({
  db: {},
}));

import { makeStoreRepo } from "../store-repository";
import type { DbClient } from "@/lib/db/client";
import type { BasicInfo } from "@/types/basic-info";

const DB_ROW = {
  id: "store-1",
  name: "炉端ジュン",
  prefecture: "東京都",
  city: "渋谷区",
  address: "渋谷1-2-3",
  genre: "居酒屋",
  priority: "中",
  stage: "未調査",
  channel: "未判定",
  has_contact_form: "不明",
  map_url: "",
  site_url: "",
  instagram_url: "",
  phone: "",
  target_service: "",
  review_count: 0,
  review_avg: 0,
  memo: "",
  assigned_planner_user_id: null,
  assigned_sales_user_id: null,
  operator_type: "未設定",
  operator_name: "",
  ai_analysis_result: null,
  lat: null,
  lng: null,
  google_place_id: null,
  appointment_acquired_date: null,
  next_action_date: null,
  next_action_note: null,
  basic_info: {},
  created_at: "2026-08-01",
  updated_at: "2026-08-01",
};

/**
 * `update(...).set(...).where(...).returning()` チェーンをモックし、
 * `set()` に渡された payload を捕捉する。
 */
function makeUpdateExecutor(returnedRows: Array<Record<string, unknown>> = [DB_ROW]) {
  const set = vi.fn();
  const returning = vi.fn().mockResolvedValue(returnedRows);
  const where = vi.fn().mockReturnValue({ returning });
  set.mockReturnValue({ where });
  const update = vi.fn().mockReturnValue({ set });
  const executor = { update } as unknown as DbClient;
  return { executor, set, capturedSet: () => set.mock.calls[0]![0] as Record<string, unknown> };
}

/** `getForUpdate` → `update` の 2 段チェーン(mergeBasicInfo 用)。 */
function makeMergeExecutor(currentRow: Record<string, unknown> = DB_ROW) {
  const limit = vi.fn().mockResolvedValue([currentRow]);
  const forUpdate = vi.fn().mockReturnValue({ limit });
  const selectWhere = vi.fn().mockReturnValue({ for: forUpdate, limit });
  const from = vi.fn().mockReturnValue({ where: selectWhere });
  const select = vi.fn().mockReturnValue({ from });

  const set = vi.fn();
  const returning = vi.fn().mockResolvedValue([currentRow]);
  const updateWhere = vi.fn().mockReturnValue({ returning });
  set.mockReturnValue({ where: updateWhere });
  const update = vi.fn().mockReturnValue({ set });

  const executor = { select, update } as unknown as DbClient;
  return { executor, capturedSet: () => set.mock.calls[0]![0] as Record<string, unknown> };
}

describe("update — patch で指定された列だけを SET する", () => {
  it("{ memo } は memo と updated_at だけを SET する", async () => {
    const { executor, capturedSet } = makeUpdateExecutor();
    await makeStoreRepo(executor).update("store-1", { memo: "架電済み" });

    const payload = capturedSet();
    expect(Object.keys(payload).sort()).toEqual(["memo", "updated_at"]);
    expect(payload.memo).toBe("架電済み");
  });

  it("{ stage } は stage と updated_at だけを SET する", async () => {
    const { executor, capturedSet } = makeUpdateExecutor();
    await makeStoreRepo(executor).update("store-1", { stage: "調査済み" });

    expect(Object.keys(capturedSet()).sort()).toEqual(["stage", "updated_at"]);
  });

  it("{ basic_info } は basic_info と updated_at だけを SET する", async () => {
    const basicInfo: BasicInfo = {
      review_avg: {
        value: "4.4",
        tier: "A",
        filled_by: "places",
        updated_at: "2026-08-12T00:00:00.000Z",
      },
    };
    const { executor, capturedSet } = makeUpdateExecutor();
    await makeStoreRepo(executor).update("store-1", { basic_info: basicInfo });

    const payload = capturedSet();
    expect(Object.keys(payload).sort()).toEqual(["basic_info", "updated_at"]);
    expect(payload.basic_info).toEqual(basicInfo);
  });

  it("**patch に無い列(basic_info 等)を SET payload へ含めない**(lost update 防止の本体)", async () => {
    const { executor, capturedSet } = makeUpdateExecutor();
    await makeStoreRepo(executor).update("store-1", { stage: "調査済み" });

    const payload = capturedSet();
    for (const key of ["basic_info", "memo", "name", "ai_analysis_result", "phone"]) {
      expect(payload).not.toHaveProperty(key);
    }
  });

  it("複数フィールドの patch は指定分だけを SET する", async () => {
    const { executor, capturedSet } = makeUpdateExecutor();
    await makeStoreRepo(executor).update("store-1", {
      stage: "調査済み",
      channel: "テレアポ推奨",
    });

    expect(Object.keys(capturedSet()).sort()).toEqual(["channel", "stage", "updated_at"]);
  });
});

describe("update — 値の変換と null/undefined の扱い", () => {
  it("ai_analysis_result(オブジェクト)は JSON 文字列へ変換して SET する", async () => {
    const analysis = { summary: "テスト" } as never;
    const { executor, capturedSet } = makeUpdateExecutor();
    await makeStoreRepo(executor).update("store-1", { ai_analysis_result: analysis });

    const payload = capturedSet();
    expect(typeof payload.ai_analysis_result).toBe("string");
    expect(JSON.parse(payload.ai_analysis_result as string)).toEqual({ summary: "テスト" });
  });

  it("ai_analysis_result: null は文字列化せず null を SET する", async () => {
    const { executor, capturedSet } = makeUpdateExecutor();
    await makeStoreRepo(executor).update("store-1", { ai_analysis_result: null });

    const payload = capturedSet();
    expect(payload.ai_analysis_result).toBeNull();
    expect(Object.keys(payload).sort()).toEqual(["ai_analysis_result", "updated_at"]);
  });

  it("nullable フィールドを null にする patch が失われない", async () => {
    const { executor, capturedSet } = makeUpdateExecutor();
    await makeStoreRepo(executor).update("store-1", {
      appointment_acquired_date: null,
      next_action_date: null,
      next_action_note: null,
      assigned_sales_user_id: null,
      lat: null,
    });

    const payload = capturedSet();
    expect(payload.appointment_acquired_date).toBeNull();
    expect(payload.next_action_date).toBeNull();
    expect(payload.next_action_note).toBeNull();
    expect(payload.assigned_sales_user_id).toBeNull();
    expect(payload.lat).toBeNull();
  });

  it("undefined の値は「変更しない」として SET payload から除外する", async () => {
    const { executor, capturedSet } = makeUpdateExecutor();
    await makeStoreRepo(executor).update("store-1", {
      memo: "x",
      appointment_acquired_date: undefined,
    });

    const payload = capturedSet();
    expect(Object.keys(payload).sort()).toEqual(["memo", "updated_at"]);
    expect(payload).not.toHaveProperty("appointment_acquired_date");
  });

  it("空 patch でも updated_at だけは更新する(従来挙動を維持)", async () => {
    const { executor, capturedSet } = makeUpdateExecutor();
    await makeStoreRepo(executor).update("store-1", {});

    expect(Object.keys(capturedSet())).toEqual(["updated_at"]);
  });
});

describe("update — 戻り値", () => {
  it("更新後の行を Store として返す", async () => {
    const { executor } = makeUpdateExecutor([{ ...DB_ROW, stage: "調査済み" }]);
    const result = await makeStoreRepo(executor).update("store-1", { stage: "調査済み" });

    expect(result?.id).toBe("store-1");
    expect(result?.stage).toBe("調査済み");
  });

  it("該当行が無ければ null を返す(従来挙動を維持)", async () => {
    const { executor } = makeUpdateExecutor([]);
    await expect(makeStoreRepo(executor).update("missing", { stage: "調査済み" })).resolves.toBeNull();
  });
});

describe("mergeBasicInfo — basic_info 列だけを SET する", () => {
  it("SET payload は basic_info と updated_at のみ", async () => {
    const { executor, capturedSet } = makeMergeExecutor();
    await makeStoreRepo(executor).mergeBasicInfo(
      "store-1",
      {
        review_avg: {
          value: "4.4",
          tier: "A",
          filled_by: "places",
          updated_at: "2026-08-12T00:00:00.000Z",
        },
      },
      "places",
    );

    expect(Object.keys(capturedSet()).sort()).toEqual(["basic_info", "updated_at"]);
  });

  it("patch 外の列(name / stage 等)を巻き戻さない", async () => {
    const { executor, capturedSet } = makeMergeExecutor();
    await makeStoreRepo(executor).mergeBasicInfo("store-1", {}, "places");

    const payload = capturedSet();
    for (const key of ["name", "stage", "memo", "ai_analysis_result"]) {
      expect(payload).not.toHaveProperty(key);
    }
  });
});
