/**
 * mergeBasicInfo 純関数の単体検証 (store-basic-info / Issue #114, #121)
 *
 * 受け入れ基準 (requirements 5.1 / 5.2 / 5.3 / 6.1 / 6.2) と design 不変条件
 * (入力非変更、キー集合包含、updated_at スタンプ、未知キー無視) を直接検証する。
 *
 * `BASIC_INFO_ITEMS` の実定義を母体に、primary="places" 項目と primary="manual"
 * 項目をそれぞれ代表サンプルとして使う(モック差替えはしない)。
 */

import { describe, it, expect } from "vitest";
import { mergeBasicInfo } from "../basic-info-merge";
import { BASIC_INFO_ITEMS } from "../basic-info-items";
import type {
  BasicInfo,
  BasicInfoField,
  FillSource,
} from "@/types/basic-info";

// ---- テスト固定値 ---------------------------------------------------------

const NOW = "2026-06-08T10:00:00.000Z";
const EARLIER = "2026-01-01T00:00:00.000Z";

// 実定義から primary 別の代表キーを抽出 (リファクタ追随性のため)
const PLACES_PRIMARY_KEY = BASIC_INFO_ITEMS.find(
  (item) => item.primary === "places",
)!.key; // 例: store_name
const MANUAL_PRIMARY_KEY = BASIC_INFO_ITEMS.find(
  (item) => item.primary === "manual",
)!.key; // 例: opening_date

function field(
  value: string | null,
  filled_by: FillSource | null,
  tier: "A" | "B" | "C" = "A",
  updated_at: string = EARLIER,
): BasicInfoField {
  return { value, tier, filled_by, updated_at };
}

// ---- R5.1 / R6.2 手動値の保護 ---------------------------------------------

describe("mergeBasicInfo - R5.1/R6.2 手動値の保護", () => {
  it("既存が手動値の項目は places 自動充填で上書きされない (primary=places でも)", () => {
    const current: BasicInfo = {
      [PLACES_PRIMARY_KEY]: field("手動で入れた値", "manual"),
    };
    const incoming: Partial<BasicInfo> = {
      [PLACES_PRIMARY_KEY]: field("Places から来た値", "places"),
    };

    const result = mergeBasicInfo(current, incoming, "places", NOW);

    expect(result[PLACES_PRIMARY_KEY]?.value).toBe("手動で入れた値");
    expect(result[PLACES_PRIMARY_KEY]?.filled_by).toBe("manual");
    expect(result[PLACES_PRIMARY_KEY]?.updated_at).toBe(EARLIER);
  });

  it("既存が手動値の項目は非 primary 自動充填でも上書きされない (primary=manual)", () => {
    const current: BasicInfo = {
      [MANUAL_PRIMARY_KEY]: field("手動値", "manual"),
    };
    const incoming: Partial<BasicInfo> = {
      [MANUAL_PRIMARY_KEY]: field("Places 提供候補", "places"),
    };

    const result = mergeBasicInfo(current, incoming, "places", NOW);

    expect(result[MANUAL_PRIMARY_KEY]?.value).toBe("手動値");
    expect(result[MANUAL_PRIMARY_KEY]?.filled_by).toBe("manual");
  });
});

// ---- R5.2 primary 一致で上書き --------------------------------------------

describe("mergeBasicInfo - R5.2 優先ソース一致で上書き", () => {
  it("primary=places の項目は places 充填で既存自動値を上書きする", () => {
    const current: BasicInfo = {
      [PLACES_PRIMARY_KEY]: field("古い Places 値", "places"),
    };
    const incoming: Partial<BasicInfo> = {
      [PLACES_PRIMARY_KEY]: field("新しい Places 値", "places"),
    };

    const result = mergeBasicInfo(current, incoming, "places", NOW);

    expect(result[PLACES_PRIMARY_KEY]?.value).toBe("新しい Places 値");
    expect(result[PLACES_PRIMARY_KEY]?.filled_by).toBe("places");
    expect(result[PLACES_PRIMARY_KEY]?.updated_at).toBe(NOW);
  });

  it("primary=places の項目が未充足なら places 充填で埋まる (新規追加)", () => {
    const current: BasicInfo = {};
    const incoming: Partial<BasicInfo> = {
      [PLACES_PRIMARY_KEY]: field("新規 Places 値", "places"),
    };

    const result = mergeBasicInfo(current, incoming, "places", NOW);

    expect(result[PLACES_PRIMARY_KEY]?.value).toBe("新規 Places 値");
    expect(result[PLACES_PRIMARY_KEY]?.filled_by).toBe("places");
    expect(result[PLACES_PRIMARY_KEY]?.updated_at).toBe(NOW);
  });
});

// ---- R5.3 非 primary の自動ソースは空欄補完のみ ---------------------------

describe("mergeBasicInfo - R5.3 非 primary 自動ソースは空欄補完のみ", () => {
  it("primary=manual の項目に places 充填: 既存空欄なら埋まる", () => {
    const current: BasicInfo = {};
    const incoming: Partial<BasicInfo> = {
      [MANUAL_PRIMARY_KEY]: field("Places 推測値", "places"),
    };

    const result = mergeBasicInfo(current, incoming, "places", NOW);

    expect(result[MANUAL_PRIMARY_KEY]?.value).toBe("Places 推測値");
    expect(result[MANUAL_PRIMARY_KEY]?.filled_by).toBe("places");
    expect(result[MANUAL_PRIMARY_KEY]?.updated_at).toBe(NOW);
  });

  it("primary=manual の項目に places 充填: 既存値ありなら保持される (manual でなくても)", () => {
    const current: BasicInfo = {
      [MANUAL_PRIMARY_KEY]: field("既存自動値", "places"),
    };
    const incoming: Partial<BasicInfo> = {
      [MANUAL_PRIMARY_KEY]: field("新しい候補", "places"),
    };

    const result = mergeBasicInfo(current, incoming, "places", NOW);

    expect(result[MANUAL_PRIMARY_KEY]?.value).toBe("既存自動値");
    expect(result[MANUAL_PRIMARY_KEY]?.updated_at).toBe(EARLIER);
  });

  it("既存 value が空文字でも未充足として補完される", () => {
    const current: BasicInfo = {
      [MANUAL_PRIMARY_KEY]: field("", "places"),
    };
    const incoming: Partial<BasicInfo> = {
      [MANUAL_PRIMARY_KEY]: field("補完値", "places"),
    };

    const result = mergeBasicInfo(current, incoming, "places", NOW);

    expect(result[MANUAL_PRIMARY_KEY]?.value).toBe("補完値");
  });

  it("既存 value が空白のみでも未充足として補完される", () => {
    const current: BasicInfo = {
      [MANUAL_PRIMARY_KEY]: field("   ", "places"),
    };
    const incoming: Partial<BasicInfo> = {
      [MANUAL_PRIMARY_KEY]: field("補完値", "places"),
    };

    const result = mergeBasicInfo(current, incoming, "places", NOW);

    expect(result[MANUAL_PRIMARY_KEY]?.value).toBe("補完値");
  });
});

// ---- R6.1 manual ソースは常に上書き ---------------------------------------

describe("mergeBasicInfo - R6.1 manual ソースは常に上書き", () => {
  it("manual 充填は既存自動値を上書きする", () => {
    const current: BasicInfo = {
      [PLACES_PRIMARY_KEY]: field("Places 値", "places"),
    };
    const incoming: Partial<BasicInfo> = {
      [PLACES_PRIMARY_KEY]: field("手動編集値", "manual"),
    };

    const result = mergeBasicInfo(current, incoming, "manual", NOW);

    expect(result[PLACES_PRIMARY_KEY]?.value).toBe("手動編集値");
    expect(result[PLACES_PRIMARY_KEY]?.filled_by).toBe("manual");
    expect(result[PLACES_PRIMARY_KEY]?.updated_at).toBe(NOW);
  });

  it("manual 充填は既存 manual 値も上書きする (再編集)", () => {
    const current: BasicInfo = {
      [MANUAL_PRIMARY_KEY]: field("古い手動値", "manual"),
    };
    const incoming: Partial<BasicInfo> = {
      [MANUAL_PRIMARY_KEY]: field("新しい手動値", "manual"),
    };

    const result = mergeBasicInfo(current, incoming, "manual", NOW);

    expect(result[MANUAL_PRIMARY_KEY]?.value).toBe("新しい手動値");
    expect(result[MANUAL_PRIMARY_KEY]?.updated_at).toBe(NOW);
  });
});

// ---- source 引数による filled_by 確定 ------------------------------------

describe("mergeBasicInfo - source 引数で filled_by を確定", () => {
  it("incoming.filled_by が違っても source 引数の値が真実", () => {
    const current: BasicInfo = {};
    // 悪意ある or 誤った incoming.filled_by を渡しても source が真実
    const incoming: Partial<BasicInfo> = {
      [PLACES_PRIMARY_KEY]: field("値", "manual"),
    };

    const result = mergeBasicInfo(current, incoming, "places", NOW);

    expect(result[PLACES_PRIMARY_KEY]?.filled_by).toBe("places");
  });
});

// ---- 不変条件: 入力非変更 ----------------------------------------------

describe("mergeBasicInfo - 入力を変更しない", () => {
  it("current オブジェクトは変更されない (参照は別、値も不変)", () => {
    const original: BasicInfo = {
      [PLACES_PRIMARY_KEY]: field("元の値", "places"),
    };
    const currentSnapshot = JSON.parse(JSON.stringify(original)) as BasicInfo;
    const incoming: Partial<BasicInfo> = {
      [PLACES_PRIMARY_KEY]: field("新しい値", "places"),
    };

    const result = mergeBasicInfo(original, incoming, "places", NOW);

    expect(result).not.toBe(original);
    expect(original).toEqual(currentSnapshot);
  });

  it("採用された field は新オブジェクト (current の field と参照同一でない)", () => {
    const originalField = field("元", "manual");
    const current: BasicInfo = { [PLACES_PRIMARY_KEY]: originalField };
    const incoming: Partial<BasicInfo> = {
      [PLACES_PRIMARY_KEY]: field("手動更新", "manual"),
    };

    const result = mergeBasicInfo(current, incoming, "manual", NOW);

    expect(result[PLACES_PRIMARY_KEY]).not.toBe(originalField);
    expect(originalField.value).toBe("元"); // 元 field 自体は不変
  });
});

// ---- 不変条件: 出力キー集合 ⊇ current のキー集合 -----------------------

describe("mergeBasicInfo - 出力キー集合は current を内包する", () => {
  it("current にあるが incoming に無いキーはそのまま残る", () => {
    const current: BasicInfo = {
      [PLACES_PRIMARY_KEY]: field("既存", "places"),
      [MANUAL_PRIMARY_KEY]: field("既存 manual", "manual"),
    };
    const incoming: Partial<BasicInfo> = {
      [PLACES_PRIMARY_KEY]: field("新", "places"),
    };

    const result = mergeBasicInfo(current, incoming, "places", NOW);

    expect(Object.keys(result).sort()).toEqual(
      Object.keys(current).sort(),
    );
    expect(result[MANUAL_PRIMARY_KEY]?.value).toBe("既存 manual");
  });

  it("incoming が空でも current のコピーを返す", () => {
    const current: BasicInfo = {
      [PLACES_PRIMARY_KEY]: field("既存", "places"),
    };

    const result = mergeBasicInfo(current, {}, "places", NOW);

    expect(result).toEqual(current);
    expect(result).not.toBe(current);
  });
});

// ---- 未知キーは無視 -------------------------------------------------------

describe("mergeBasicInfo - 未知キーは無視 (precondition violation 防御)", () => {
  it("BASIC_INFO_ITEMS に存在しないキーは結果に含まれない", () => {
    const current: BasicInfo = {};
    const incoming: Partial<BasicInfo> = {
      __unknown_key__: field("ゴミ", "places"),
    };

    const result = mergeBasicInfo(current, incoming, "places", NOW);

    expect(result.__unknown_key__).toBeUndefined();
  });
});
