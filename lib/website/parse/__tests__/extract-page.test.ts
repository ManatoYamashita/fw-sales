import { describe, expect, it } from "vitest";
import { extractPage } from "../extract-page";

const SOURCE_URL = "https://example-restaurant.com/";

function buildHtml(body: string, jsonLd?: unknown): string {
  const jsonLdScript = jsonLd ? `<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>` : "";
  return `<!doctype html>
<html>
<head>
  <title>テスト食堂 | 公式サイト</title>
  <meta name="description" content="渋谷の隠れ家イタリアン。">
  <link rel="canonical" href="https://example-restaurant.com/">
  ${jsonLdScript}
</head>
<body>
  <h1>テスト食堂へようこそ</h1>
  ${body}
</body>
</html>`;
}

describe("extractPage", () => {
  it("title / meta description / h1 / canonical を抽出する", () => {
    const page = extractPage(buildHtml(""), SOURCE_URL);
    expect(page.title).toBe("テスト食堂 | 公式サイト");
    expect(page.metaDescription).toBe("渋谷の隠れ家イタリアン。");
    expect(page.h1).toBe("テスト食堂へようこそ");
    expect(page.canonical).toBe("https://example-restaurant.com/");
  });

  it("og:descriptionをmeta descriptionのfallbackとして使う", () => {
    const html = `<html><head><title>t</title><meta property="og:description" content="OG説明"></head><body></body></html>`;
    const page = extractPage(html, SOURCE_URL);
    expect(page.metaDescription).toBe("OG説明");
  });

  it("Restaurant JSON-LDからjsonld_name/address/phoneを抽出する", () => {
    const html = buildHtml("", {
      "@type": "Restaurant",
      name: "テスト食堂",
      telephone: "03-1111-2222",
      address: { "@type": "PostalAddress", addressRegion: "東京都", addressLocality: "渋谷区" },
    });
    const result = extractPage(html, SOURCE_URL);
    expect(result.jsonLdName).toBe("テスト食堂");
    expect(result.jsonLdPhone).toBe("03-1111-2222");
    expect(result.jsonLdAddress).toBe("東京都 渋谷区");
    expect(result.jsonLdTypes).toContain("Restaurant");
  });

  it("tel:リンクからphoneLinksを抽出する", () => {
    const html = buildHtml(`<a href="tel:03-1111-2222">お電話はこちら</a>`);
    const page = extractPage(html, SOURCE_URL);
    expect(page.phoneLinks).toEqual(["03-1111-2222"]);
  });

  it("instagram.comへのリンクをinstagramLinksとして抽出する", () => {
    const html = buildHtml(`<a href="https://instagram.com/teststore">Instagram</a>`);
    const page = extractPage(html, SOURCE_URL);
    expect(page.instagramLinks).toEqual(["https://instagram.com/teststore"]);
  });

  it("JSON-LDのsameAs経由でもinstagramLinksを抽出する", () => {
    const html = buildHtml("", {
      "@type": "Restaurant",
      name: "店",
      sameAs: ["https://instagram.com/teststore", "https://twitter.com/teststore"],
    });
    const page = extractPage(html, SOURCE_URL);
    expect(page.instagramLinks).toEqual(["https://instagram.com/teststore"]);
  });

  it("anchorとsameAs両方から見つかった場合は重複除去する", () => {
    const html = buildHtml(`<a href="https://instagram.com/teststore">IG</a>`, {
      "@type": "Restaurant",
      name: "店",
      sameAs: ["https://instagram.com/teststore"],
    });
    const page = extractPage(html, SOURCE_URL);
    expect(page.instagramLinks).toEqual(["https://instagram.com/teststore"]);
  });

  it("menuキーワードに一致するリンクをmenuLinksとして抽出する", () => {
    const html = buildHtml(`<a href="/menu">メニュー</a><a href="/about">お店について</a>`);
    const page = extractPage(html, SOURCE_URL);
    expect(page.menuLinks).toEqual(["https://example-restaurant.com/menu"]);
  });

  it("reserveキーワードに一致するリンクをreservationLinksとして抽出する", () => {
    const html = buildHtml(`<a href="/reserve">ご予約</a>`);
    const page = extractPage(html, SOURCE_URL);
    expect(page.reservationLinks).toEqual(["https://example-restaurant.com/reserve"]);
  });

  it("予約provider host(Tabelog等)へのリンクもキーワード無しでreservationLinksに含める", () => {
    const html = buildHtml(`<a href="https://tabelog.com/tokyo/A1301/A130101/12345/">お店情報</a>`);
    const page = extractPage(html, SOURCE_URL);
    expect(page.reservationLinks).toEqual(["https://tabelog.com/tokyo/A1301/A130101/12345/"]);
  });

  it("Instagram/Facebook等のsocial providerはreservationLinksに含めない(キーワード一致が無い限り)", () => {
    const html = buildHtml(`<a href="https://instagram.com/teststore">IG</a>`);
    const page = extractPage(html, SOURCE_URL);
    expect(page.reservationLinks).toEqual([]);
  });

  it("全ての<a href>をlinksとして生のまま保持する(未フィルタ)", () => {
    const html = buildHtml(`<a href="/menu">メニュー</a><a href="https://tabelog.com/x">食べログ</a>`);
    const page = extractPage(html, SOURCE_URL);
    expect(page.links).toEqual(
      expect.arrayContaining([
        { url: "/menu", anchorText: "メニュー" },
        { url: "https://tabelog.com/x", anchorText: "食べログ" },
      ]),
    );
  });

  it("identityEvidenceを含む(strong JSON-LD + h1 + title)", () => {
    const html = buildHtml("", { "@type": "Restaurant", name: "テスト食堂", telephone: "03-1111-2222" });
    const page = extractPage(html, SOURCE_URL);
    expect(page.identityEvidence.names.some((n) => n.strength === "strong")).toBe(true);
    expect(page.identityEvidence.phones.some((p) => p.strength === "strong")).toBe(true);
  });

  it("生HTMLを結果に保持しない", () => {
    const page = extractPage(buildHtml(""), SOURCE_URL);
    expect((page as unknown as Record<string, unknown>).html).toBeUndefined();
    expect(JSON.stringify(page)).not.toContain("<html>");
  });

  it("不正なJSON-LDでも例外を投げない", () => {
    const html = `<html><head><title>t</title><script type="application/ld+json">{bad json</script></head><body></body></html>`;
    expect(() => extractPage(html, SOURCE_URL)).not.toThrow();
  });

  it("Restaurant と Organization の値を1レコードとして混ぜない(MEDIUM-1 回帰)", () => {
    const html = `<html><head><title>t</title>
      <script type="application/ld+json">${JSON.stringify({ "@type": "Restaurant", name: "レストランA" })}</script>
      <script type="application/ld+json">${JSON.stringify({
        "@type": "Organization",
        name: "運営会社B",
        address: "本社住所B",
        telephone: "03-9999-9999",
      })}</script>
    </head><body></body></html>`;
    const page = extractPage(html, SOURCE_URL);
    // primary は Restaurant。Organization の address/telephone を借りてこない。
    expect(page.jsonLdName).toBe("レストランA");
    expect(page.jsonLdAddress).toBeNull();
    expect(page.jsonLdPhone).toBeNull();
    // ただし identity evidence には weak として全て残る
    expect(page.identityEvidence.names.map((n) => n.value)).toContain("運営会社B");
    expect(page.identityEvidence.addresses[0]).toMatchObject({ value: "本社住所B", strength: "weak" });
    expect(page.identityEvidence.phones[0]).toMatchObject({ value: "03-9999-9999", strength: "weak" });
  });

  it("strong nodeが複数ならscalar signalをambiguousとして出さない", () => {
    const html = `<html><head><title>t</title>
      <script type="application/ld+json">${JSON.stringify({ "@type": "Restaurant", name: "支店1", telephone: "03-1" })}</script>
      <script type="application/ld+json">${JSON.stringify({ "@type": "Restaurant", name: "支店2", telephone: "03-2" })}</script>
    </head><body></body></html>`;
    const page = extractPage(html, SOURCE_URL);
    expect(page.jsonLdName).toBeNull();
    expect(page.jsonLdPhone).toBeNull();
    // evidence には両方残る(Phase 3 の判定材料を失わない)
    expect(page.identityEvidence.names.map((n) => n.value)).toEqual(
      expect.arrayContaining(["支店1", "支店2"]),
    );
  });

  it("Organizationのみのページでは店舗scalarへ昇格させない", () => {
    const html = `<html><head><title>t</title>
      <script type="application/ld+json">${JSON.stringify({
        "@type": "Organization",
        name: "運営会社",
        address: "本社住所",
        telephone: "03-9999-9999",
      })}</script>
    </head><body></body></html>`;
    const page = extractPage(html, SOURCE_URL);
    expect(page.jsonLdName).toBeNull();
    expect(page.jsonLdAddress).toBeNull();
    expect(page.jsonLdPhone).toBeNull();
    expect(page.identityEvidence.names[0]).toMatchObject({ strength: "weak", provenance: "json_ld_organization" });
  });

  it("WebPage.mainEntity にネストしたRestaurantからもscalarを抽出する", () => {
    const html = `<html><head><title>t</title>
      <script type="application/ld+json">${JSON.stringify({
        "@type": "WebPage",
        name: "ページ名",
        mainEntity: { "@type": "Restaurant", name: "ネスト店", telephone: "03-5555-6666" },
      })}</script>
    </head><body></body></html>`;
    const page = extractPage(html, SOURCE_URL);
    expect(page.jsonLdName).toBe("ネスト店");
    expect(page.jsonLdPhone).toBe("03-5555-6666");
    expect(page.jsonLdTypes).toEqual(expect.arrayContaining(["WebPage", "Restaurant"]));
  });

  it("title/meta/h1が長い場合はtruncateする", () => {
    const longTitle = "あ".repeat(300);
    const html = `<html><head><title>${longTitle}</title></head><body></body></html>`;
    const page = extractPage(html, SOURCE_URL);
    expect(page.title?.length).toBe(200);
  });
});
