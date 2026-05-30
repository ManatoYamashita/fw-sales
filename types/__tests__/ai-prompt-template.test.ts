import { describe, expect, it } from "vitest";

import {
  parseFewshots,
  parseTemplateBody,
  serializeFewshots,
  serializeFreeform,
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
  it("FewShotExample[]を{ kind, fewshots: [...] }形式のJSON文字列にする", () => {
    const result = serializeFewshots([EXAMPLE_A]);
    const parsed = JSON.parse(result) as unknown;
    expect(parsed).toEqual({ kind: "fewshots", fewshots: [EXAMPLE_A] });
  });

  it("空配列を{ kind, fewshots: [] }にシリアライズする", () => {
    const result = serializeFewshots([]);
    expect(JSON.parse(result)).toEqual({ kind: "fewshots", fewshots: [] });
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

// ---------------------------------------------------------------------------
// parseTemplateBody (判別共用体 + 後方互換)
// ---------------------------------------------------------------------------

describe("parseTemplateBody", () => {
  it("kind=fewshots の body を fewshots として解釈する", () => {
    const body = serializeFewshots([EXAMPLE_A, EXAMPLE_B]);
    const result = parseTemplateBody(body);
    expect(result).toEqual({
      kind: "fewshots",
      fewshots: [EXAMPLE_A, EXAMPLE_B],
    });
  });

  it("kind=freeform の body を freeform として解釈する", () => {
    const body = serializeFreeform("丁寧なトーンで分析してください");
    const result = parseTemplateBody(body);
    expect(result).toEqual({
      kind: "freeform",
      text: "丁寧なトーンで分析してください",
    });
  });

  it("空文字の freeform text も保持する", () => {
    const result = parseTemplateBody(JSON.stringify({ kind: "freeform", text: "" }));
    expect(result).toEqual({ kind: "freeform", text: "" });
  });

  it("後方互換: kind 無し + fewshots 配列を fewshots として解釈する", () => {
    const legacy = JSON.stringify({ fewshots: [EXAMPLE_A] });
    const result = parseTemplateBody(legacy);
    expect(result).toEqual({ kind: "fewshots", fewshots: [EXAMPLE_A] });
  });

  it("freeform で text が文字列でない場合は null", () => {
    expect(
      parseTemplateBody(JSON.stringify({ kind: "freeform", text: 42 })),
    ).toBeNull();
    expect(
      parseTemplateBody(JSON.stringify({ kind: "freeform" })),
    ).toBeNull();
  });

  it("未知の kind は null", () => {
    expect(
      parseTemplateBody(JSON.stringify({ kind: "unknown", text: "x" })),
    ).toBeNull();
  });

  it("不正 JSON / null / 配列は null", () => {
    expect(parseTemplateBody("not json")).toBeNull();
    expect(parseTemplateBody("")).toBeNull();
    expect(parseTemplateBody(JSON.stringify(null))).toBeNull();
    expect(parseTemplateBody(JSON.stringify([EXAMPLE_A]))).toBeNull();
  });

  it("kind=fewshots でも fewshots が不正なら null", () => {
    expect(
      parseTemplateBody(JSON.stringify({ kind: "fewshots", fewshots: "x" })),
    ).toBeNull();
    expect(
      parseTemplateBody(
        JSON.stringify({ kind: "fewshots", fewshots: [{ title: 1 }] }),
      ),
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// serializeFreeform
// ---------------------------------------------------------------------------

describe("serializeFreeform", () => {
  it("text を { kind: 'freeform', text } 形式の JSON 文字列にする", () => {
    const result = serializeFreeform("自由記述テキスト");
    expect(JSON.parse(result)).toEqual({
      kind: "freeform",
      text: "自由記述テキスト",
    });
  });

  it("serializeFreeform → parseTemplateBody の roundtrip が成立する", () => {
    const text = "改行も\n保持される\nテキスト";
    const parsed = parseTemplateBody(serializeFreeform(text));
    expect(parsed).toEqual({ kind: "freeform", text });
  });

  it("freeform body は parseFewshots では null になる", () => {
    expect(parseFewshots(serializeFreeform("x"))).toBeNull();
  });
});
