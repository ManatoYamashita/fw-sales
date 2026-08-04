import { describe, expect, it } from "vitest";
import * as cheerio from "cheerio";
import {
  parseJsonLd,
  selectPrimaryIdentityNode,
  STRONG_ENTITY_TYPES,
  WEAK_ENTITY_TYPES,
  MAX_JSONLD_NODES,
  type JsonLdIdentityNode,
} from "../json-ld";

function load(jsonLdScripts: string[]): cheerio.CheerioAPI {
  const scripts = jsonLdScripts
    .map((json) => `<script type="application/ld+json">${json}</script>`)
    .join("\n");
  return cheerio.load(`<html><head>${scripts}</head><body></body></html>`);
}

describe("parseJsonLd", () => {
  it("Restaurant nodeをstrong identityとして抽出する", () => {
    const $ = load([
      JSON.stringify({
        "@context": "https://schema.org",
        "@type": "Restaurant",
        name: "テスト食堂",
        telephone: "03-1111-2222",
        address: {
          "@type": "PostalAddress",
          postalCode: "150-0001",
          addressRegion: "東京都",
          addressLocality: "渋谷区",
          streetAddress: "神南1-1-1",
        },
      }),
    ]);
    const result = parseJsonLd($);
    expect(result.allTypes).toContain("Restaurant");
    expect(result.identityNodes).toHaveLength(1);
    expect(result.identityNodes[0]).toMatchObject({
      strength: "strong",
      name: "テスト食堂",
      telephone: "03-1111-2222",
    });
    expect(result.identityNodes[0]!.address).toBe("〒150-0001 東京都 渋谷区 神南1-1-1");
  });

  it("全てのSTRONG_ENTITY_TYPESをstrongとして扱う", () => {
    for (const type of STRONG_ENTITY_TYPES) {
      const $ = load([JSON.stringify({ "@type": type, name: "店" })]);
      const result = parseJsonLd($);
      expect(result.identityNodes[0]?.strength).toBe("strong");
    }
  });

  it("Organizationはweakとして扱う", () => {
    for (const type of WEAK_ENTITY_TYPES) {
      const $ = load([JSON.stringify({ "@type": type, name: "運営会社株式会社" })]);
      const result = parseJsonLd($);
      expect(result.identityNodes[0]?.strength).toBe("weak");
    }
  });

  it("BreadcrumbListをidentity evidenceから除外する(nameを持っていても)", () => {
    const $ = load([
      JSON.stringify({
        "@type": "BreadcrumbList",
        itemListElement: [{ name: "トップ" }],
        name: "パンくずリスト",
      }),
    ]);
    const result = parseJsonLd($);
    expect(result.allTypes).toContain("BreadcrumbList");
    expect(result.identityNodes).toHaveLength(0);
  });

  it("WebSite / WebPage / Article / Person 等も除外する", () => {
    const excludedTypes = ["WebSite", "WebPage", "Article", "BlogPosting", "Person", "Product", "Event"];
    for (const type of excludedTypes) {
      const $ = load([JSON.stringify({ "@type": type, name: "何か" })]);
      const result = parseJsonLd($);
      expect(result.identityNodes).toHaveLength(0);
    }
  });

  it("@graph内を再帰的に走査する", () => {
    const $ = load([
      JSON.stringify({
        "@context": "https://schema.org",
        "@graph": [
          { "@type": "WebSite", name: "サイト名" },
          { "@type": "Restaurant", name: "奥のレストラン" },
        ],
      }),
    ]);
    const result = parseJsonLd($);
    expect(result.allTypes).toEqual(expect.arrayContaining(["WebSite", "Restaurant"]));
    expect(result.identityNodes).toHaveLength(1);
    expect(result.identityNodes[0]?.name).toBe("奥のレストラン");
  });

  it("@typeが配列の場合、いずれかがstrongならstrong扱い", () => {
    const $ = load([JSON.stringify({ "@type": ["Thing", "Restaurant"], name: "複数型" })]);
    const result = parseJsonLd($);
    expect(result.identityNodes[0]?.strength).toBe("strong");
  });

  it("不正なJSONを無視する(例外を投げない)", () => {
    const $ = cheerio.load(
      `<html><head><script type="application/ld+json">{invalid json,,,</script></head></html>`,
    );
    expect(() => parseJsonLd($)).not.toThrow();
    expect(parseJsonLd($).identityNodes).toHaveLength(0);
  });

  it("sameAsを収集する(文字列・配列両対応)", () => {
    const $ = load([
      JSON.stringify({ "@type": "Restaurant", name: "店A", sameAs: "https://instagram.com/storea" }),
      JSON.stringify({
        "@type": "Restaurant",
        name: "店B",
        sameAs: ["https://instagram.com/storeb", "https://twitter.com/storeb"],
      }),
    ]);
    const result = parseJsonLd($);
    expect(result.identityNodes[0]?.sameAs).toEqual(["https://instagram.com/storea"]);
    expect(result.identityNodes[1]?.sameAs).toEqual([
      "https://instagram.com/storeb",
      "https://twitter.com/storeb",
    ]);
  });

  it("allTypesは重複除去する", () => {
    const $ = load([
      JSON.stringify({ "@type": "Restaurant", name: "A" }),
      JSON.stringify({ "@type": "Restaurant", name: "B" }),
    ]);
    const result = parseJsonLd($);
    expect(result.allTypes).toEqual(["Restaurant"]);
  });

  it("addressが文字列の場合はそのまま採用する", () => {
    const $ = load([JSON.stringify({ "@type": "Restaurant", name: "店", address: "東京都渋谷区1-1-1" })]);
    const result = parseJsonLd($);
    expect(result.identityNodes[0]?.address).toBe("東京都渋谷区1-1-1");
  });

  it("壊れたblockがあっても他のblockのsignalを失わない", () => {
    const $ = cheerio.load(`<html><head>
      <script type="application/ld+json">{broken,,,</script>
      <script type="application/ld+json">${JSON.stringify({ "@type": "Restaurant", name: "生存店" })}</script>
    </head></html>`);
    const result = parseJsonLd($);
    expect(result.identityNodes).toHaveLength(1);
    expect(result.identityNodes[0]?.name).toBe("生存店");
    expect(result.allTypes).toContain("Restaurant");
  });
});

describe("parseJsonLd: nested traversal(@graph 以外)", () => {
  it("WebPage.mainEntity にネストした Restaurant を検出する", () => {
    const $ = load([
      JSON.stringify({
        "@type": "WebPage",
        name: "ページ",
        mainEntity: { "@type": "Restaurant", name: "奥の店", telephone: "03-1111-2222" },
      }),
    ]);
    const result = parseJsonLd($);
    expect(result.allTypes).toEqual(expect.arrayContaining(["WebPage", "Restaurant"]));
    expect(result.identityNodes).toHaveLength(1);
    expect(result.identityNodes[0]).toMatchObject({ strength: "strong", name: "奥の店" });
  });

  it("about / subjectOf にネストした node も検出する", () => {
    for (const prop of ["about", "subjectOf"]) {
      const $ = load([
        JSON.stringify({ "@type": "WebPage", [prop]: { "@type": "Restaurant", name: `${prop}の店` } }),
      ]);
      const result = parseJsonLd($);
      expect(result.identityNodes[0]?.name).toBe(`${prop}の店`);
    }
  });

  it("itemListElement 内のネストした配列を走査する", () => {
    const $ = load([
      JSON.stringify({
        "@type": "ItemList",
        itemListElement: [
          { "@type": "ListItem", item: { "@type": "Restaurant", name: "リスト内の店" } },
        ],
      }),
    ]);
    const result = parseJsonLd($);
    expect(result.identityNodes).toHaveLength(1);
    expect(result.identityNodes[0]?.name).toBe("リスト内の店");
  });

  it("深くネストした配列/objectの混在を走査する", () => {
    const $ = load([
      JSON.stringify({
        "@type": "WebPage",
        parts: [[{ inner: { deeper: [{ "@type": "Restaurant", name: "深い店" }] } }]],
      }),
    ]);
    expect(parseJsonLd($).identityNodes[0]?.name).toBe("深い店");
  });

  it("トップレベル配列を走査する", () => {
    const $ = load([
      JSON.stringify([
        { "@type": "WebSite", name: "サイト" },
        { "@type": "Restaurant", name: "配列の店" },
      ]),
    ]);
    const result = parseJsonLd($);
    expect(result.identityNodes).toHaveLength(1);
    expect(result.identityNodes[0]?.name).toBe("配列の店");
  });

  it("address の PostalAddress を独立nodeとして二重計上しない", () => {
    const $ = load([
      JSON.stringify({
        "@type": "Restaurant",
        name: "店",
        address: { "@type": "PostalAddress", addressLocality: "渋谷区" },
      }),
    ]);
    const result = parseJsonLd($);
    expect(result.identityNodes).toHaveLength(1);
    expect(result.allTypes).not.toContain("PostalAddress");
    expect(result.identityNodes[0]?.address).toBe("渋谷区");
  });

  it("正常な入力では truncated が false", () => {
    const $ = load([JSON.stringify({ "@type": "Restaurant", name: "店" })]);
    expect(parseJsonLd($).truncated).toBe(false);
  });

  it("極端に深いネストで打ち切り、例外を投げない", () => {
    let deep: Record<string, unknown> = { "@type": "Restaurant", name: "最深部" };
    for (let i = 0; i < 200; i++) deep = { nested: deep };
    const $ = load([JSON.stringify(deep)]);
    expect(() => parseJsonLd($)).not.toThrow();
    const result = parseJsonLd($);
    expect(result.truncated).toBe(true);
    // 上限より深い node は観測されない(取りこぼしは安全側)
    expect(result.identityNodes).toHaveLength(0);
  });

  it("極端に多いnode数で打ち切り、例外を投げない", () => {
    const many = Array.from({ length: MAX_JSONLD_NODES + 500 }, (_, i) => ({
      "@type": "Thing",
      name: `n${i}`,
    }));
    const $ = load([JSON.stringify(many)]);
    expect(() => parseJsonLd($)).not.toThrow();
    expect(parseJsonLd($).truncated).toBe(true);
  });

  it("打ち切りが起きても他のJSON-LD blockの解析は続行する", () => {
    let deep: Record<string, unknown> = { leaf: true };
    for (let i = 0; i < 200; i++) deep = { nested: deep };
    const $ = load([JSON.stringify(deep), JSON.stringify({ "@type": "Restaurant", name: "健全な店" })]);
    const result = parseJsonLd($);
    expect(result.identityNodes.map((n) => n.name)).toContain("健全な店");
  });
});

describe("selectPrimaryIdentityNode(entity 混在の禁止)", () => {
  function node(overrides: Partial<JsonLdIdentityNode>): JsonLdIdentityNode {
    return { strength: "strong", name: null, address: null, telephone: null, sameAs: [], ...overrides };
  }

  it("strong nodeがちょうど1件ならその node を返す", () => {
    const strong = node({ name: "店", address: "住所", telephone: "03-1" });
    expect(selectPrimaryIdentityNode([strong])).toBe(strong);
  });

  it("strong nodeが複数なら ambiguous として null", () => {
    const a = node({ name: "支店1" });
    const b = node({ name: "支店2" });
    expect(selectPrimaryIdentityNode([a, b])).toBeNull();
  });

  it("strong nodeが0件なら Organization があっても null(店舗factへ昇格しない)", () => {
    const org = node({ strength: "weak", name: "運営会社", address: "本社住所", telephone: "03-9" });
    expect(selectPrimaryIdentityNode([org])).toBeNull();
  });

  it("weakが複数あってもstrongが1件なら strong を返す", () => {
    const strong = node({ name: "店" });
    const weak1 = node({ strength: "weak", name: "会社1" });
    const weak2 = node({ strength: "weak", name: "会社2" });
    expect(selectPrimaryIdentityNode([weak1, strong, weak2])).toBe(strong);
  });

  it("空配列は null", () => {
    expect(selectPrimaryIdentityNode([])).toBeNull();
  });
});
