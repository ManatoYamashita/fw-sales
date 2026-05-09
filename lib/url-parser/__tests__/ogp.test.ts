/**
 * fetchOgp 内部の extractFromHtml をテストする。
 * fetchOgp 自体はネットワーク依存のためテストせず、HTML 文字列を渡す内部関数の挙動を検証する。
 *
 * extractFromHtml は ogp.ts の export ではないため、fetchOgp を経由してテストする選択肢もあるが、
 * ここでは ogp.ts の export を fetchOgp のみに限定して、本テストは public API + fixture HTML の
 * 統合テストとして fetchOgp を間接利用する。
 *
 * 軽量化のため、fetch を vi.fn() でモックして HTML 文字列を返却させる。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchOgp } from "../ogp";

describe("fetchOgp + extractFromHtml (P1 cheerio + JSON-LD)", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  function mockFetch(html: string, status = 200) {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      text: async () => html,
    } as Response) as unknown as typeof globalThis.fetch;
  }

  it("title からの name 抽出: ブラックリスト 'Google マップ' は破棄", async () => {
    mockFetch("<html><head><title>Google マップ</title></head></html>");
    const result = await fetchOgp("https://example.com/test");
    expect(result.ok).toBe(true);
    expect(result.name).toBeUndefined();
  });

  it("title からの name 抽出: 通常のタイトルは採用", async () => {
    mockFetch("<html><head><title>導楽 | 食べログ</title></head></html>");
    const result = await fetchOgp("https://example.com/test");
    expect(result.ok).toBe(true);
    expect(result.name).toBe("導楽");
  });

  it("og:title からの name 抽出: title が空のとき og:title を使う", async () => {
    mockFetch(`
      <html><head>
        <title></title>
        <meta property="og:title" content="導楽 - 食べログ" />
      </head></html>
    `);
    const result = await fetchOgp("https://example.com/test");
    expect(result.name).toBe("導楽");
  });

  it("JSON-LD Restaurant schema: name / phone / address / rating / reviewCount を抽出", async () => {
    mockFetch(`
      <html><head><title>導楽</title>
        <script type="application/ld+json">
        {
          "@context": "https://schema.org",
          "@type": "Restaurant",
          "name": "導楽",
          "telephone": "044-750-9977",
          "url": "https://example.com/dougaku",
          "address": {
            "streetAddress": "新丸子東1-983",
            "addressLocality": "川崎市中原区",
            "addressRegion": "神奈川県",
            "postalCode": "211-0004"
          },
          "aggregateRating": {
            "ratingValue": "3.4",
            "reviewCount": "12"
          }
        }
        </script>
      </head></html>
    `);
    const result = await fetchOgp("https://tabelog.com/kanagawa/A1405/A140504/14096697/");
    expect(result.ok).toBe(true);
    expect(result.name).toBe("導楽");
    expect(result.phone).toBe("044-750-9977");
    expect(result.rating).toBe(3.4);
    expect(result.review_count).toBe(12);
    expect(result.address).toContain("神奈川県");
    expect(result.address).toContain("川崎市中原区");
    expect(result.address).toContain("新丸子東1-983");
    // 異なるホスト名なので site_url 採用
    expect(result.site_url).toBe("https://example.com/dougaku");
  });

  it("JSON-LD: 同一ホスト名の url は site_url に採用しない", async () => {
    mockFetch(`
      <html><head>
        <script type="application/ld+json">
        { "@type": "Restaurant", "name": "店舗A", "url": "https://tabelog.com/self-link" }
        </script>
      </head></html>
    `);
    const result = await fetchOgp("https://tabelog.com/some/store/");
    expect(result.site_url).toBeUndefined();
  });

  it("HTTP エラーステータスは ok: false でエラーメッセージを返す", async () => {
    mockFetch("not found", 404);
    const result = await fetchOgp("https://example.com/missing");
    expect(result.ok).toBe(false);
    expect(result.error).toBe("HTTP 404");
  });

  it("空の URL は即座に ok: false", async () => {
    const result = await fetchOgp("");
    expect(result.ok).toBe(false);
  });

  it("「3.4 点」形式のフォールバック評価抽出", async () => {
    mockFetch(`
      <html><body>
        <p>食べログ評価 3.4 点</p>
      </body></html>
    `);
    const result = await fetchOgp("https://example.com/x");
    expect(result.rating).toBe(3.4);
  });

  it("「口コミ N 件」形式の口コミ件数抽出", async () => {
    mockFetch(`
      <html><body>
        <span>口コミ 12 件</span>
      </body></html>
    `);
    const result = await fetchOgp("https://example.com/x");
    expect(result.review_count).toBe(12);
  });

  it("0\\d{1,4}-\\d{1,4}-\\d{4} 形式の電話番号フォールバック抽出", async () => {
    mockFetch(`<html><body><p>連絡先: 03-1234-5678</p></body></html>`);
    const result = await fetchOgp("https://example.com/x");
    expect(result.phone).toBe("03-1234-5678");
  });

  // ==========================================================================
  // Phase 3.1: 運営者抽出 + HTML 全文保持(Req 1.3)
  // ==========================================================================

  it("運営者抽出: JSON-LD parentOrganization.name から取得 (source=json_ld)", async () => {
    mockFetch(`
      <html><head>
        <script type="application/ld+json">
        {
          "@type": "Restaurant",
          "name": "店舗A",
          "parentOrganization": { "name": "株式会社テストフード" }
        }
        </script>
      </head></html>
    `);
    const result = await fetchOgp("https://example.com/x");
    expect(result.operator).toBeDefined();
    expect(result.operator?.value).toBe("株式会社テストフード");
    expect(result.operator?.source).toBe("json_ld");
  });

  it("運営者抽出: 食べログ DOM 「運営者」行から取得 (source=tabelog_dom)", async () => {
    mockFetch(`
      <html><body>
        <table>
          <tr>
            <th>運営者</th>
            <td>山田太郎</td>
          </tr>
        </table>
      </body></html>
    `);
    const result = await fetchOgp("https://example.com/x");
    expect(result.operator).toBeDefined();
    expect(result.operator?.value).toBe("山田太郎");
    expect(result.operator?.source).toBe("tabelog_dom");
  });

  it("運営者抽出: 「運営会社」ラベルでも DOM 抽出が動作", async () => {
    mockFetch(`
      <html><body>
        <table>
          <tr>
            <th>運営会社</th>
            <td>株式会社○○フードサービス</td>
          </tr>
        </table>
      </body></html>
    `);
    const result = await fetchOgp("https://example.com/x");
    expect(result.operator?.value).toBe("株式会社○○フードサービス");
    expect(result.operator?.source).toBe("tabelog_dom");
  });

  it("運営者抽出: JSON-LD と DOM が両方あれば JSON-LD 優先", async () => {
    mockFetch(`
      <html>
        <head>
          <script type="application/ld+json">
          {
            "@type": "Restaurant",
            "name": "店舗A",
            "parentOrganization": { "name": "JSON-LD 由来の運営者" }
          }
          </script>
        </head>
        <body>
          <table>
            <tr>
              <th>運営者</th>
              <td>DOM 由来の運営者</td>
            </tr>
          </table>
        </body>
      </html>
    `);
    const result = await fetchOgp("https://example.com/x");
    expect(result.operator?.value).toBe("JSON-LD 由来の運営者");
    expect(result.operator?.source).toBe("json_ld");
  });

  it("運営者抽出: ラベル不在なら operator は undefined", async () => {
    mockFetch(`<html><body><p>運営情報なし</p></body></html>`);
    const result = await fetchOgp("https://example.com/x");
    expect(result.operator).toBeUndefined();
  });

  it("HTML 全文保持: ok 時に html フィールドが含まれる", async () => {
    mockFetch(
      `<html><head><title>テスト</title></head><body><p>本文</p></body></html>`,
    );
    const result = await fetchOgp("https://example.com/x");
    expect(result.html).toBeDefined();
    expect(result.html).toMatch(/本文/);
  });

  it("HTML 全文保持: <script>/<style>/<svg>/<noscript> は除去される (payload 削減)", async () => {
    const inputHtml = `
      <html>
        <head>
          <script>const secret = "hidden";</script>
          <style>.hidden { display: none }</style>
        </head>
        <body>
          <noscript>fallback content</noscript>
          <svg><circle cx="50" cy="50" r="40" /></svg>
          <p>本文だけ残る</p>
        </body>
      </html>
    `;
    mockFetch(inputHtml);
    const result = await fetchOgp("https://example.com/x");
    expect(result.html).toBeDefined();
    expect(result.html).toMatch(/本文だけ残る/);
    // 除去対象タグの中身が含まれない
    expect(result.html).not.toMatch(/const secret/);
    expect(result.html).not.toMatch(/\.hidden\s*{/);
    expect(result.html).not.toMatch(/fallback content/);
    expect(result.html).not.toMatch(/<circle/);
    // 当然 input より小さい
    expect(result.html!.length).toBeLessThan(inputHtml.length);
  });
});
