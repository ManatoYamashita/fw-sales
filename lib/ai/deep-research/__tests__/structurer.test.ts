/**
 * `parseAndValidateStructurerText` の単体テスト
 * (deep-research-pipeline spec, Issue #43, Task 2.5)
 *
 * SDK 呼出と分離した純関数のため、モック SDK 不要で検証できる (SDK 呼出自体の
 * 統合テストは Task 6.2 で行う)。
 *
 * カバレッジ (5 ケース):
 * 1. 正常な 8 カテゴリ・最小項目 JSON で構造化成功
 * 2. tier=B で confidence 欠落 → schema_violation
 * 3. 空文字列 → empty_response
 * 4. 不正 JSON → invalid_json
 * 5. all_source_urls 空配列 → sourceUrlsFallback で補完
 *
 * 関連: requirements.md §3.1, §3.2, §3.3, §3.4, §3.5
 */

import { describe, expect, it } from "vitest";
import { parseAndValidateStructurerText } from "../structurer";

interface PayloadItem {
  key: string;
  label: string;
  tier: "A" | "B" | "C";
  value: string | null;
  confidence?: number;
  source_urls?: string[];
  source_quote?: string;
  hearing_question?: string;
}

interface Payload {
  category_1_basic: PayloadItem[];
  category_2_owner: PayloadItem[];
  category_3_menu: PayloadItem[];
  category_4_customer: PayloadItem[];
  category_5_marketing: PayloadItem[];
  category_6_competitor: PayloadItem[];
  category_7_owned_media: PayloadItem[];
  category_8_other: PayloadItem[];
  hearing_questions: { category: string; question: string }[];
  full_markdown: string;
  all_source_urls: string[];
}

function makeValidPayload(): Payload {
  const okItem: PayloadItem = {
    key: "store_name",
    label: "屋号",
    tier: "A",
    value: "サンプル食堂",
  };
  return {
    category_1_basic: [okItem],
    category_2_owner: [],
    category_3_menu: [],
    category_4_customer: [],
    category_5_marketing: [],
    category_6_competitor: [],
    category_7_owned_media: [],
    category_8_other: [],
    hearing_questions: [],
    full_markdown: "## 屋号\nサンプル食堂",
    all_source_urls: ["https://example.com"],
  };
}

describe("parseAndValidateStructurerText", () => {
  it("正常な JSON 入力で構造化成功", () => {
    const json = JSON.stringify(makeValidPayload());
    const result = parseAndValidateStructurerText(json, []);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.category_1_basic).toHaveLength(1);
      expect(result.data.full_markdown).toContain("サンプル食堂");
    }
  });

  it("tier=B で confidence 欠落 → schema_violation", () => {
    const payload = makeValidPayload();
    payload.category_1_basic = [
      {
        key: "average_spend",
        label: "客単価",
        tier: "B",
        value: "2000 円",
        // confidence/source_urls/source_quote をわざと欠落
      },
    ];
    const result = parseAndValidateStructurerText(
      JSON.stringify(payload),
      [],
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("schema_violation");
      if (result.error.kind === "schema_violation") {
        expect(
          result.error.zodIssues.some((s) => s.includes("confidence")),
        ).toBe(true);
      }
    }
  });

  it("空文字列 → empty_response", () => {
    const result = parseAndValidateStructurerText("", []);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("empty_response");
    }
  });

  it("不正 JSON → invalid_json", () => {
    const result = parseAndValidateStructurerText("{ not json", []);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("invalid_json");
    }
  });

  it("all_source_urls 空配列なら sourceUrlsFallback で補完される", () => {
    const payload = makeValidPayload();
    payload.all_source_urls = [];
    const result = parseAndValidateStructurerText(JSON.stringify(payload), [
      "https://fallback.example.com",
      "https://fallback.example.com", // 重複: dedupe で 1 件に
      "https://another.example.com",
    ]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.all_source_urls).toEqual([
        "https://fallback.example.com",
        "https://another.example.com",
      ]);
    }
  });
});
