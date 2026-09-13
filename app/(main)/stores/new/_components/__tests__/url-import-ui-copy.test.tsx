/**
 * URL Import まわりの UI 文言の回帰テスト (Issue #207)。
 *
 * Google マップ専用化に伴う文言変更は、実装だけ直して案内文が古いままだと
 * ユーザーが「食べログも貼れる」と誤解したまま 403 に当たり続けるため、
 * **stale copy をテストで固定する**。
 *
 * `renderToStaticMarkup` を使い、新しいテスト依存 (testing-library 等) を追加しない
 * (既存 `stores-table-view.test.tsx` / `research-*-render.test.tsx` と同じ方針)。
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { AppliedField } from "@/lib/url-parser/types";

// `registration-mode-card` は Server Action を import しており、その先で
// `@/lib/db` が DATABASE_URL を要求する。本テストは文言のみを検証するため、
// Action は呼び出さない前提で軽量モックに差し替える。
vi.mock("@/lib/actions/url-parse-actions", () => ({ importFromUrlAction: vi.fn() }));
vi.mock("@/lib/actions/area-search-actions", () => ({
  searchPlacesWithMatchesAction: vi.fn(),
}));

const { ManualStartPanel, REJECT_MESSAGE, UrlSearchPanel } = await import(
  "../registration-mode-card"
);
const { UrlImportSummary } = await import("../url-import-summary");

function markup(node: React.ReactElement): string {
  return renderToStaticMarkup(node);
}

describe("UrlSearchPanel の案内文 (Google マップ専用)", () => {
  const html = markup(<UrlSearchPanel onLoaded={() => {}} />);

  it("Googleマップの店舗ページURLを求める説明を出す", () => {
    expect(html).toContain("Googleマップの店舗ページURL");
    expect(html).toContain("店舗名・住所・電話番号・口コミ情報");
  });

  /**
   * 「Google の共有リンクなら何でも使える」と読める表現にしない。
   * 実際に読めるのは `maps.app.goo.gl` 形式で、`share.google` 形式は
   * Google 検索へ転送され Place ID が得られないため未対応 (PR #285 実 URL 検証)。
   */
  it("対応する共有リンクの形式を明示する", () => {
    expect(html).toContain("maps.app.goo.gl");
  });

  it("食べログを案内しない (stale copy 回帰)", () => {
    expect(html).not.toContain("食べログ");
    expect(html).not.toContain("tabelog");
  });

  it("placeholder が Google マップ URL になっている", () => {
    expect(html).toContain("https://www.google.com/maps/place/");
    expect(html).not.toContain("https://tabelog.com/");
  });

  it("入力欄の aria-label が GoogleマップURL になっている", () => {
    expect(html).toContain('aria-label="GoogleマップURL"');
  });
});

describe("受付拒否の文言 (REJECT_MESSAGE)", () => {
  /**
   * 短縮 URL の「取得に失敗した」を「別種の URL を貼れ」と案内しないこと。
   * 案内が取り違うと、有効な共有 URL を持つユーザーが貼り直しを繰り返す (PR #211 review)。
   */
  it("short_url_resolve_failed は再試行を促し、URL の貼り直しを求めない", () => {
    const message = REJECT_MESSAGE.short_url_resolve_failed;
    expect(message).toContain("読み込めませんでした");
    expect(message).toContain("もう一度お試しください");
    expect(message).not.toContain("貼り付けてください");
  });

  it("not_place_url の文言は変えない", () => {
    expect(REJECT_MESSAGE.not_place_url).toBe(
      "店舗ページのGoogleマップURLを貼り付けてください。",
    );
  });

  it("いずれの文言にも内部技術用語を含めない", () => {
    for (const message of Object.values(REJECT_MESSAGE)) {
      for (const term of [
        "OGP",
        "HTTP",
        "DNS",
        "Cloudflare",
        "Vercel",
        "fetch",
        "redirect",
        "リダイレクト",
        "タイムアウト",
      ]) {
        expect(message).not.toContain(term);
      }
    }
  });
});

describe("ManualStartPanel の案内文", () => {
  it("食べログに言及しない", () => {
    const html = markup(<ManualStartPanel onStart={() => {}} />);
    expect(html).toContain("GoogleマップURLやエリア検索を使わず");
    expect(html).not.toContain("食べログ");
  });
});

describe("UrlImportSummary の表示", () => {
  const applied: AppliedField[] = [
    { key: "name", label: "店舗名", value: "導楽", confidence: 88 },
    { key: "phone", label: "電話番号", value: "", confidence: undefined },
  ];

  it("内部識別子ではなくユーザー向け表記を出す", () => {
    const html = markup(
      <UrlImportSummary sourceType="google_maps" applied={applied} storeName="導楽" />,
    );
    expect(html).toContain("Googleマップ");
    // 内部の ParsedSource 値がそのまま画面へ出ていないこと。
    expect(html).not.toContain("google_maps");
  });

  it("内部技術情報 (OGP / HTTP status) を表示しない", () => {
    const html = markup(
      <UrlImportSummary sourceType="google_maps" applied={applied} storeName="導楽" />,
    );
    expect(html).not.toContain("OGP");
    expect(html).not.toContain("HTTP");
  });
});

/**
 * 対応 URL 形式を広げたときに案内文が古いままだと、
 * 「店舗を開いた状態のリンクは使えない」と誤解したまま使われ続ける。
 */
describe("UrlSearchPanel の案内文 (対応形式の拡張)", () => {
  const html = markup(<UrlSearchPanel onLoaded={() => {}} />);

  /**
   * 読み込めない共有リンクを貼ったユーザーが次に取れる行動を示す
   * (「対応していません」だけで終わらせない)。
   */
  it("読み込めない共有リンクの代替手順を案内する", () => {
    expect(html).toContain("share.google");
    expect(html).toContain("アドレスバー");
  });

  it("Googleの共有リンクなら何でも使えるとは書かない", () => {
    expect(html).not.toContain("共有リンクなら");
    expect(html).not.toContain("共有リンクすべて");
  });

  it("検索結果一覧のURLが使えないことを案内する", () => {
    expect(html).toContain("検索結果");
  });

  it("技術用語を一般ユーザー向けに出さない", () => {
    for (const term of ["query_place_id", "Place ID", "placeId", "Places API", "cid="]) {
      expect(html).not.toContain(term);
    }
  });
});

describe("REJECT_MESSAGE (取得失敗の文言)", () => {
  it("place_lookup_failed は貼り直しを第一に促さない", () => {
    const message = REJECT_MESSAGE.place_lookup_failed;
    // URL 自体は 1 店舗を指しているため、`not_place_url` の文言と同一にしない。
    expect(message).not.toBe(REJECT_MESSAGE.not_place_url);
    expect(message).toContain("時間をおいて");
  });

  it("全 reason の文言に技術用語を出さない", () => {
    for (const message of Object.values(REJECT_MESSAGE)) {
      for (const term of ["Place ID", "query_place_id", "Places API", "HTTP", "API"]) {
        expect(message).not.toContain(term);
      }
    }
  });
});
