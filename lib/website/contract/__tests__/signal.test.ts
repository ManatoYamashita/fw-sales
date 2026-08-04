import { describe, expect, it } from "vitest";
import {
  WebsiteDigitalSignalSchema,
  WEBSITE_SIGNAL_STATUSES,
  WEBSITE_CLAIMABILITIES,
  WEBSITE_SCANNER_PROVENANCE,
} from "../signal";

function baseSignal(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    key: "website_title",
    value: { type: "string", value: "テスト店舗" },
    status: "observed",
    identity: "target_match",
    claimability: "FACT_SAFE",
    provenance: WEBSITE_SCANNER_PROVENANCE,
    source_urls: ["https://example.com/"],
    observed_at: new Date().toISOString(),
    ...overrides,
  };
}

describe("WebsiteDigitalSignalSchema", () => {
  it("observed + 非noneのvalueは有効", () => {
    const result = WebsiteDigitalSignalSchema.safeParse(baseSignal());
    expect(result.success).toBe(true);
  });

  it("not_observed + value.type=noneは有効", () => {
    const result = WebsiteDigitalSignalSchema.safeParse(
      baseSignal({ status: "not_observed", value: { type: "none" }, claimability: "INTERNAL_ONLY" }),
    );
    expect(result.success).toBe(true);
  });

  it("observedなのにvalue.type=noneは無効(不変条件違反)", () => {
    const result = WebsiteDigitalSignalSchema.safeParse(baseSignal({ value: { type: "none" } }));
    expect(result.success).toBe(false);
  });

  it("not_observedなのにvalueを持つのは無効(不変条件違反)", () => {
    const result = WebsiteDigitalSignalSchema.safeParse(
      baseSignal({ status: "not_observed", claimability: "INTERNAL_ONLY" }),
    );
    expect(result.success).toBe(false);
  });

  it("not_applicable は Website Scanner subset の status に含まれない(型レベルで拒否)", () => {
    const result = WebsiteDigitalSignalSchema.safeParse(baseSignal({ status: "not_applicable" }));
    expect(result.success).toBe(false);
  });

  it("absent_confirmed は Website Scanner subset の status に含まれない(型レベルで拒否)", () => {
    const result = WebsiteDigitalSignalSchema.safeParse(baseSignal({ status: "absent_confirmed" }));
    expect(result.success).toBe(false);
  });

  it("QUESTION_ONLY は Website Scanner subset の claimability に含まれない(型レベルで拒否)", () => {
    const result = WebsiteDigitalSignalSchema.safeParse(baseSignal({ claimability: "QUESTION_ONLY" }));
    expect(result.success).toBe(false);
  });

  it("provenance は website_scanner_v1 固定値以外を拒否する", () => {
    const result = WebsiteDigitalSignalSchema.safeParse(baseSignal({ provenance: "ai_research_pipeline" }));
    expect(result.success).toBe(false);
  });

  it("WEBSITE_SIGNAL_STATUSES はちょうど3値(observed/not_observed/inaccessible)", () => {
    expect([...WEBSITE_SIGNAL_STATUSES].sort()).toEqual(["inaccessible", "not_observed", "observed"]);
  });

  it("WEBSITE_CLAIMABILITIES はちょうど3値(FACT_SAFE/INTERNAL_ONLY/DO_NOT_USE)", () => {
    expect([...WEBSITE_CLAIMABILITIES].sort()).toEqual(["DO_NOT_USE", "FACT_SAFE", "INTERNAL_ONLY"]);
  });
});
