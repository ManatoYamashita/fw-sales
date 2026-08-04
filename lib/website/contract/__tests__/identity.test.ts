import { describe, expect, it } from "vitest";
import {
  WEBSITE_IDENTITY_STATUSES,
  INITIAL_WEBSITE_IDENTITY_STATUS,
  IdentityCandidateSchema,
  WebsiteIdentityEvidenceSchema,
  EMPTY_IDENTITY_EVIDENCE,
} from "../identity";

describe("WebsiteIdentityStatus", () => {
  it("5値を持つ", () => {
    expect([...WEBSITE_IDENTITY_STATUSES].sort()).toEqual(
      ["candidate_known_url", "target_match", "trusted_manual", "uncertain", "unrelated"].sort(),
    );
  });

  it("初期状態は candidate_known_url", () => {
    expect(INITIAL_WEBSITE_IDENTITY_STATUS).toBe("candidate_known_url");
  });
});

describe("IdentityCandidateSchema", () => {
  it("有効な candidate を受理する", () => {
    const result = IdentityCandidateSchema.safeParse({
      value: "テスト店舗",
      strength: "strong",
      source_url: "https://example.com/",
      provenance: "json_ld_strong_entity",
    });
    expect(result.success).toBe(true);
  });

  it("未知の provenance を拒否する", () => {
    const result = IdentityCandidateSchema.safeParse({
      value: "テスト店舗",
      strength: "strong",
      source_url: "https://example.com/",
      provenance: "gemini_search_candidate",
    });
    expect(result.success).toBe(false);
  });

  it("空文字の value を拒否する", () => {
    const result = IdentityCandidateSchema.safeParse({
      value: "",
      strength: "weak",
      source_url: "https://example.com/",
      provenance: "h1",
    });
    expect(result.success).toBe(false);
  });
});

describe("WebsiteIdentityEvidenceSchema", () => {
  it("空のevidenceを受理する", () => {
    expect(WebsiteIdentityEvidenceSchema.safeParse(EMPTY_IDENTITY_EVIDENCE).success).toBe(true);
  });
});
