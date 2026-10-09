import { describe, expect, it } from "vitest";
import { splitStoreNameMemo } from "../store-name-memo";

describe("splitStoreNameMemo (#297)", () => {
  it.each([
    // 本番の /stores で観察された実例 (Issue #297 の原文)
    ["（Rアポハマロスト）炉端ジュン", "Rアポハマロスト", "炉端ジュン"],
    ["（Rアポ、過去ロストのため各バツ）日本橋 竹田", "Rアポ、過去ロストのため各バツ", "日本橋 竹田"],
    ["（アプ即否）RESTAURANT L’ESPRIT DE CHEVALIER", "アプ即否", "RESTAURANT L’ESPRIT DE CHEVALIER"],
    ["（確バツ）おゆげ 自由が丘", "確バツ", "おゆげ 自由が丘"],
    ["（せロスト）いな穂", "せロスト", "いな穂"],
    ["（Rアポ・不通差し戻し）盛和餃子酒場", "Rアポ・不通差し戻し", "盛和餃子酒場"],
    ["（7月24日NEW）Bistro Norc", "7月24日NEW", "Bistro Norc"],
    ["（3月OPen）Brasserie NORMAN", "3月OPen", "Brasserie NORMAN"],
  ])("%s からメモを取り出す", (name, memo, cleaned) => {
    expect(splitStoreNameMemo(name)).toEqual({ memo, name: cleaned });
  });

  it("半角・隅付き・全半角混在の括弧も拾う", () => {
    expect(splitStoreNameMemo("(Rアポ) 店A")).toEqual({ memo: "Rアポ", name: "店A" });
    expect(splitStoreNameMemo("【確バツ】店B")).toEqual({ memo: "確バツ", name: "店B" });
    expect(splitStoreNameMemo("（Rアポ)店C")).toEqual({ memo: "Rアポ", name: "店C" });
    expect(splitStoreNameMemo("［ロスト］店D")).toEqual({ memo: "ロスト", name: "店D" });
  });

  it("先頭に連続する括弧書きはまとめて取る", () => {
    expect(splitStoreNameMemo("（Rアポ）（3月OPen）店E")).toEqual({ memo: "Rアポ / 3月OPen", name: "店E" });
  });

  it("メモが無い店舗名は null", () => {
    expect(splitStoreNameMemo("炉端ジュン")).toBeNull();
    expect(splitStoreNameMemo("")).toBeNull();
  });

  it("店舗名の途中や末尾の括弧はメモとみなさない (支店名などの正規表記)", () => {
    expect(splitStoreNameMemo("さくら屋 (渋谷店)")).toBeNull();
    expect(splitStoreNameMemo("鳥貴族（新宿東口店）")).toBeNull();
  });

  it("法人格の略記は屋号の一部なので取らない", () => {
    expect(splitStoreNameMemo("(株)サンプルダイニング")).toBeNull();
    expect(splitStoreNameMemo("（有）やきとり大吉")).toBeNull();
  });

  it("取り除くと店舗名が空になる場合は null (括弧書きそのものが屋号)", () => {
    expect(splitStoreNameMemo("（仮）")).toBeNull();
    expect(splitStoreNameMemo("（Rアポ）  ")).toBeNull();
  });

  it("空の括弧は読み飛ばし、メモが無ければ null", () => {
    expect(splitStoreNameMemo("（）店F")).toBeNull();
  });
});
