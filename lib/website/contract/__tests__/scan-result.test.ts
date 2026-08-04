import { describe, expect, it } from "vitest";
import { WebsiteScanResultSchema, SCAN_STATUSES } from "../scan-result";
import { EMPTY_IDENTITY_EVIDENCE } from "../identity";

function validResult() {
  return {
    scan_status: "completed",
    candidate_url: "https://example.com/",
    final_url: "https://example.com/",
    effective_origin: "https://example.com",
    origin_redirected: false,
    security_blocked: false,
    identity_status: "candidate_known_url",
    identity_evidence: EMPTY_IDENTITY_EVIDENCE,
    signals: [],
    pages_scanned: [
      { requested_url: "https://example.com/", final_url: "https://example.com/", status: 200, outcome: "extracted" },
    ],
    warnings: [],
    scan_started_at: new Date().toISOString(),
    scan_finished_at: new Date().toISOString(),
    duration_ms: 1200,
  };
}

describe("WebsiteScanResultSchema", () => {
  it("有効な結果を受理する", () => {
    expect(WebsiteScanResultSchema.safeParse(validResult()).success).toBe(true);
  });

  it("html フィールドを持たない(生HTML保持禁止、型定義自体に存在しないことを確認)", () => {
    const withHtml = { ...validResult(), html: "<html></html>" };
    const parsed = WebsiteScanResultSchema.parse(withHtml);
    expect((parsed as Record<string, unknown>).html).toBeUndefined();
  });

  it("no_candidate_url は candidate_url が null でも有効", () => {
    const result = WebsiteScanResultSchema.safeParse({
      ...validResult(),
      scan_status: "no_candidate_url",
      candidate_url: null,
      final_url: null,
      effective_origin: null,
      pages_scanned: [],
    });
    expect(result.success).toBe(true);
  });

  it("不正な scan_status を拒否する", () => {
    const result = WebsiteScanResultSchema.safeParse({ ...validResult(), scan_status: "unknown_status" });
    expect(result.success).toBe(false);
  });

  it("SCAN_STATUSES は7値を持つ", () => {
    expect(SCAN_STATUSES.length).toBe(7);
  });
});
