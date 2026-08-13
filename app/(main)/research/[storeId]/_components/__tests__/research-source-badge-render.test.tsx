/**
 * `SourceBadge` の描画レベル検証
 * (PR #180 Sparse Store Source Identity Recovery、未確認候補タイトルの表示)。
 *
 * 実機 run(告膳)では 10 source 中 8 件が
 * `url_context_status="success"` / `identity_status="uncertain"` かつ
 * transport host(`vertexaisearch.cloud.google.com`)だったため、
 * `deriveDisplaySourceName` が「情報源(詳細不明)」しか返せず、
 * ユーザーは AI が何を見て何に失敗したのかを判断できなかった。
 *
 * Stage1 の候補タイトルを **「検索候補(未確認)」と明示して**併記するが、
 * trust boundary(clickability / confirmed 判定 / 表示名の導出)は一切変更しない。
 *
 * 本 repo には jsdom / testing-library を導入していないため、
 * `research-failed-card-render.test.tsx` と同じく `renderToStaticMarkup` を使う。
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { SourceRegistryEntry } from "@/types/research-run";
import { deriveDisplaySourceName, isSourceLinkClickable } from "@/types/research-run";
import { SourceBadge, shouldShowCandidateTitle } from "../research-source-badge";

const CANDIDATE_TITLE = "告膳(所沢駅/和食) - ホットペッパーグルメ";

function makeEntry(overrides: Partial<SourceRegistryEntry> = {}): SourceRegistryEntry {
  return {
    id: "S01",
    title: CANDIDATE_TITLE,
    // transport host。`deriveDisplaySourceName` が hostname から媒体名を導出できない形。
    grounding_redirect_url:
      "https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc",
    resolved_url: null,
    resolve_status: "skipped",
    source_type: "gourmet_site",
    discovery_provenance: "gemini_search_candidate",
    url_context_status: "success",
    identity_status: "uncertain",
    ...overrides,
  };
}

const render = (entry: SourceRegistryEntry) => renderToStaticMarkup(<SourceBadge entry={entry} />);

describe("shouldShowCandidateTitle", () => {
  it("uncertain かつ title 非空なら true", () => {
    expect(shouldShowCandidateTitle(makeEntry())).toBe(true);
  });

  it("title が空 / 空白のみなら false", () => {
    expect(shouldShowCandidateTitle(makeEntry({ title: "" }))).toBe(false);
    expect(shouldShowCandidateTitle(makeEntry({ title: "   " }))).toBe(false);
  });

  it.each(["target_match", "competitor_match", "contextual", "unrelated", "not_checked"] as const)(
    "identity_status=%s なら false",
    (identity_status) => {
      expect(shouldShowCandidateTitle(makeEntry({ identity_status }))).toBe(false);
    },
  );

  it("identity_status 未設定(旧run互換)なら false", () => {
    expect(shouldShowCandidateTitle(makeEntry({ identity_status: undefined }))).toBe(false);
  });
});

describe("SourceBadge — uncertain source の候補タイトル表示", () => {
  it("「検索候補」と「未確認」の両方を含むラベルを出す", () => {
    const html = render(makeEntry());
    expect(html).toContain("検索候補");
    expect(html).toContain("未確認");
  });

  it("候補タイトル本文を表示する", () => {
    expect(render(makeEntry())).toContain("ホットペッパーグルメ");
  });

  it("従来の警告バッジと「情報源(詳細不明)」は残る", () => {
    const html = render(makeEntry());
    expect(html).toContain("ページ取得済み・店舗同定できず");
    expect(html).toContain("情報源(詳細不明)");
  });

  it("クリック可能にしない(<a> を描画しない)", () => {
    const html = render(makeEntry());
    expect(html).not.toContain("<a ");
    expect(html).not.toContain("href=");
    expect(html).toContain("cursor-default");
  });

  it("title が空なら候補行を出さない", () => {
    const html = render(makeEntry({ title: "" }));
    expect(html).not.toContain("検索候補");
    expect(html).toContain("情報源(詳細不明)");
  });

  it("target_match では候補(未確認)行を出さない", () => {
    const html = render(makeEntry({ identity_status: "target_match" }));
    expect(html).not.toContain("検索候補");
    expect(html).not.toContain("未確認");
  });

  it("competitor_match でも候補(未確認)行を出さない", () => {
    const html = render(makeEntry({ identity_status: "competitor_match" }));
    expect(html).not.toContain("検索候補");
  });

  it("長いタイトルは truncate クラスで抑制する", () => {
    expect(render(makeEntry())).toContain("truncate");
  });
});

describe("trust boundary は変更していない", () => {
  it("deriveDisplaySourceName の戻り値が変わらない(uncertain は詳細不明のまま)", () => {
    expect(deriveDisplaySourceName(makeEntry())).toBe("情報源(詳細不明)");
    expect(deriveDisplaySourceName(makeEntry({ title: "" }))).toBe("情報源(詳細不明)");
  });

  it("isSourceLinkClickable の戻り値が変わらない", () => {
    expect(isSourceLinkClickable(makeEntry())).toBe(false);
    expect(isSourceLinkClickable(makeEntry({ identity_status: "target_match" }))).toBe(true);
    expect(
      isSourceLinkClickable(makeEntry({ discovery_provenance: "known_store_data" })),
    ).toBe(true);
  });

  it("target_match は従来どおりリンクとして描画される", () => {
    const html = render(makeEntry({ identity_status: "target_match" }));
    expect(html).toContain("<a ");
    expect(html).toContain("noopener");
  });
});
