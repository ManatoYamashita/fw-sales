/**
 * Research Evidence Precedence の単体検証
 * (feat/ai-research-quality-ux-hardening、Plan §5)。
 *
 * 本モジュールは「このrunで何を根拠にしてよいか」の序列を明文化する単一情報源であり、
 * 依存ゼロの純定数・純関数のみで構成される。ここが崩れると Theme 1/2 の
 * deterministic item 生成が丸ごと壊れるため、定数の中身そのものを固定する。
 */

import { describe, it, expect } from "vitest";
import {
  CANONICAL_FALLBACK_KEYS,
  CANONICAL_EVIDENCE_BASIS,
  canonicalFallbackRuleFor,
  isCanonicalFallbackAllowed,
} from "../evidence-precedence";
import type { BasicInfoField } from "@/types/basic-info";

function field(overrides: Partial<BasicInfoField> = {}): BasicInfoField {
  return {
    value: "何かの値",
    tier: "A",
    filled_by: "manual",
    updated_at: "2026-08-04T00:00:00.000Z",
    ...overrides,
  };
}

describe("CANONICAL_FALLBACK_KEYS", () => {
  it("実機で退化が確認された3項目のみに限定する(安易に広げない)", () => {
    expect([...CANONICAL_FALLBACK_KEYS]).toEqual([
      "review_avg",
      "review_count",
      "official_site",
    ]);
  });

  it("evidence_basisのトークンは existing_canonical", () => {
    expect(CANONICAL_EVIDENCE_BASIS).toBe("existing_canonical");
  });
});

describe("canonicalFallbackRuleFor", () => {
  it("review_avg / review_count は filled_by を問わない(過去にPlaces検証された値も有効)", () => {
    expect(canonicalFallbackRuleFor("review_avg")?.requiredFilledBy).toBeNull();
    expect(canonicalFallbackRuleFor("review_count")?.requiredFilledBy).toBeNull();
  });

  it("official_site は human-reviewed(filled_by=manual)のみ許可する", () => {
    expect(canonicalFallbackRuleFor("official_site")?.requiredFilledBy).toBe("manual");
  });

  it("allowlist外のkeyはruleを持たない", () => {
    expect(canonicalFallbackRuleFor("concept")).toBeUndefined();
    expect(canonicalFallbackRuleFor("store_name")).toBeUndefined();
  });
});

describe("isCanonicalFallbackAllowed", () => {
  it("allowlist外のkeyは常に不許可", () => {
    expect(isCanonicalFallbackAllowed("concept", field())).toBe(false);
  });

  it("fieldが未定義なら不許可", () => {
    expect(isCanonicalFallbackAllowed("review_avg", undefined)).toBe(false);
  });

  it("値が null / 空文字 / 空白のみ なら不許可", () => {
    expect(isCanonicalFallbackAllowed("review_avg", field({ value: null }))).toBe(false);
    expect(isCanonicalFallbackAllowed("review_avg", field({ value: "" }))).toBe(false);
    expect(isCanonicalFallbackAllowed("review_avg", field({ value: "   " }))).toBe(false);
  });

  it("review_avg は filled_by=places でも manual でも許可する", () => {
    expect(isCanonicalFallbackAllowed("review_avg", field({ filled_by: "places" }))).toBe(true);
    expect(isCanonicalFallbackAllowed("review_avg", field({ filled_by: "manual" }))).toBe(true);
  });

  it("official_site は filled_by=manual のみ許可し、places / null は不許可", () => {
    expect(isCanonicalFallbackAllowed("official_site", field({ filled_by: "manual" }))).toBe(true);
    expect(isCanonicalFallbackAllowed("official_site", field({ filled_by: "places" }))).toBe(false);
    expect(isCanonicalFallbackAllowed("official_site", field({ filled_by: null }))).toBe(false);
  });

  it("stores.site_url が非空であることだけでは official_site を許可しない(承認レビュー指摘1)", () => {
    // `stores.site_url` は basic_info とは別のスカラー列であり、本関数の入力ではない。
    // basic_info.official_site が空なら、site_url が何であっても fallback は成立しない。
    expect(isCanonicalFallbackAllowed("official_site", undefined)).toBe(false);
    expect(isCanonicalFallbackAllowed("official_site", field({ value: null }))).toBe(false);
  });
});
