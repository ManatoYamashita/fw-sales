/**
 * `research-source-badge.tsx` の `getBadgeDisplay` 純関数の単体検証
 * (fix/ai-research-source-identity-integrity、FIX7: 実機smoke事故を踏まえた
 * url_context_status/identity_status表示の再設計)。
 *
 * `research-failed-card.test.ts`と同じ方針: Reactレンダリングはせず、
 * 表示決定ロジックを純関数として直接検証する。
 */

import { describe, it, expect } from "vitest";
import { getBadgeDisplay } from "../research-source-badge";
import type { SourceRegistryEntry } from "@/types/research-run";

function makeEntry(overrides: Partial<SourceRegistryEntry> = {}): SourceRegistryEntry {
  return {
    id: "S01",
    title: "x",
    grounding_redirect_url: "https://example.com/a",
    resolved_url: null,
    resolve_status: "skipped",
    source_type: "gourmet_site",
    discovery_provenance: "gemini_search_candidate",
    url_context_status: "not_attempted",
    ...overrides,
  };
}

describe("getBadgeDisplay", () => {
  it("not_attemptedは検索結果情報のみバッジになる", () => {
    const result = getBadgeDisplay(makeEntry({ url_context_status: "not_attempted" }));
    expect(result).toEqual({ icon: "🔎", label: "検索結果情報のみ", tone: "warning" });
  });

  it("errorはページを確認できませんでしたバッジになる(identity_statusに関わらず)", () => {
    const result = getBadgeDisplay(
      makeEntry({ url_context_status: "error", identity_status: "target_match" }),
    );
    expect(result).toEqual({ icon: "✕", label: "ページを確認できませんでした", tone: "destructive" });
  });

  it("success + target_matchは対象店舗のページを確認バッジになる", () => {
    const result = getBadgeDisplay(
      makeEntry({ url_context_status: "success", identity_status: "target_match" }),
    );
    expect(result.label).toBe("対象店舗のページを確認");
    expect(result.tone).toBe("success");
  });

  it("success + competitor_matchは競合店のページを確認バッジになる", () => {
    const result = getBadgeDisplay(
      makeEntry({ url_context_status: "success", identity_status: "competitor_match" }),
    );
    expect(result.label).toBe("競合店のページを確認");
    expect(result.tone).toBe("info");
  });

  it("success + contextualは関連ページを確認バッジになる", () => {
    const result = getBadgeDisplay(
      makeEntry({ url_context_status: "success", identity_status: "contextual" }),
    );
    expect(result.label).toBe("関連ページを確認");
    expect(result.tone).toBe("info");
  });

  it("success + unrelated(実機smoke事故のケース)は対象店舗と無関係でしたバッジになり、destructiveトーンになる", () => {
    const result = getBadgeDisplay(
      makeEntry({ url_context_status: "success", identity_status: "unrelated" }),
    );
    expect(result.label).toBe("対象店舗と無関係でした");
    expect(result.tone).toBe("destructive");
  });

  it("success + uncertainはページ取得済み・店舗同定できずバッジになる", () => {
    const result = getBadgeDisplay(
      makeEntry({ url_context_status: "success", identity_status: "uncertain" }),
    );
    expect(result.label).toBe("ページ取得済み・店舗同定できず");
    expect(result.tone).toBe("warning");
  });

  it("success + identity_status未設定(not_checked、既存runとの後方互換)は従来どおり内容を確認済みバッジになる", () => {
    const result = getBadgeDisplay(makeEntry({ url_context_status: "success" }));
    expect(result.label).toBe("内容を確認済み");
    expect(result.tone).toBe("success");
  });
});
