import { describe, expect, it } from "vitest";

import {
  parseFewshots,
  serializeFewshots,
  type FewShotExample,
} from "../ai-prompt-template";

// ---------------------------------------------------------------------------
// テストデータ
// ---------------------------------------------------------------------------

const EXAMPLE_A: FewShotExample = {
  title: "居酒屋テンプレ",
  store_meta: "食べログ URL https://example.com/ (居酒屋・東京都)",
  call_script_ideal: "私ファーストWEBの{ASSIGNED_SALES}と申しまして...",
};

const EXAMPLE_B: FewShotExample = {
  title: "蕎麦屋テンプレ",
  store_meta: "食べログ URL https://example.com/ (蕎麦・神奈川県)",
  call_script_ideal: "ランチ終わりにすみません{ASSIGNED_SALES}...",
};

// ---------------------------------------------------------------------------
// parseFewshots
// ---------------------------------------------------------------------------

describe("parseFewshots", () => {
  it("正常なJSONからfewshots配列を返す", () => {
    const body = JSON.stringify({ fewshots: [EXAMPLE_A, EXAMPLE_B] });
    const result = parseFewshots(body);
    expect(result).toHaveLength(2);
    expect(result?.[0]).toEqual(EXAMPLE_A);
    expect(result?.[1]).toEqual(EXAMPLE_B);
  });

  it("fewshotsが空配列の場合は空配列を返す", () => {
    const body = JSON.stringify({ fewshots: [] });
    const result = parseFewshots(body);
    expect(result).toEqual([]);
  });

  it("不正JSONの場合はnullを返す", () => {
    expect(parseFewshots("not json")).toBeNull();
    expect(parseFewshots("{broken")).toBeNull();
    expect(parseFewshots("")).toBeNull();
  });

  it("fewshotsキーがない場合はnullを返す", () => {
    const body = JSON.stringify({ other: [] });
    expect(parseFewshots(body)).toBeNull();
  });

  it("fewshotsが配列でない場合はnullを返す", () => {
    expect(parseFewshots(JSON.stringify({ fewshots: null }))).toBeNull();
    expect(parseFewshots(JSON.stringify({ fewshots: "string" }))).toBeNull();
    expect(parseFewshots(JSON.stringify({ fewshots: 42 }))).toBeNull();
    expect(parseFewshots(JSON.stringify({ fewshots: {} }))).toBeNull();
  });

  it("titleが文字列でない場合はnullを返す", () => {
    const body = JSON.stringify({
      fewshots: [{ ...EXAMPLE_A, title: 123 }],
    });
    expect(parseFewshots(body)).toBeNull();
  });

  it("store_metaが文字列でない場合はnullを返す", () => {
    const body = JSON.stringify({
      fewshots: [{ ...EXAMPLE_A, store_meta: true }],
    });
    expect(parseFewshots(body)).toBeNull();
  });

  it("call_script_idealが文字列でない場合はnullを返す", () => {
    const body = JSON.stringify({
      fewshots: [{ ...EXAMPLE_A, call_script_ideal: null }],
    });
    expect(parseFewshots(body)).toBeNull();
  });

  it("トップレベルがnullの場合はnullを返す", () => {
    expect(parseFewshots(JSON.stringify(null))).toBeNull();
  });

  it("トップレベルが配列の場合はnullを返す", () => {
    expect(parseFewshots(JSON.stringify([EXAMPLE_A]))).toBeNull();
  });

  it("fewshots内の1件でも不正な場合はnullを返す", () => {
    const body = JSON.stringify({
      fewshots: [EXAMPLE_A, { title: 999, store_meta: "x", call_script_ideal: "y" }],
    });
    expect(parseFewshots(body)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// serializeFewshots
// ---------------------------------------------------------------------------

describe("serializeFewshots", () => {
  it("FewShotExample[]を{ fewshots: [...] }形式のJSON文字列にする", () => {
    const result = serializeFewshots([EXAMPLE_A]);
    const parsed = JSON.parse(result) as unknown;
    expect(parsed).toEqual({ fewshots: [EXAMPLE_A] });
  });

  it("空配列を{ fewshots: [] }にシリアライズする", () => {
    const result = serializeFewshots([]);
    expect(JSON.parse(result)).toEqual({ fewshots: [] });
  });

  it("serializeFewshots → parseFewshots のroundtripが成立する", () => {
    const examples = [EXAMPLE_A, EXAMPLE_B];
    const serialized = serializeFewshots(examples);
    const parsed = parseFewshots(serialized);
    expect(parsed).toEqual(examples);
  });

  it("複数要素のroundtripで順序が保持される", () => {
    const examples = [EXAMPLE_B, EXAMPLE_A];
    const parsed = parseFewshots(serializeFewshots(examples));
    expect(parsed?.[0]).toEqual(EXAMPLE_B);
    expect(parsed?.[1]).toEqual(EXAMPLE_A);
  });
});
