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

const { ManualStartPanel, UrlSearchPanel } = await import("../registration-mode-card");
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

  it("短縮共有リンクにも対応していることを案内する", () => {
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
