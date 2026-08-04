import { describe, expect, it } from "vitest";
import {
  GLOBAL_SIGNAL_STATUSES,
  GLOBAL_CLAIMABILITIES,
  GLOBAL_CLAIMABILITY_RANK,
  GLOBAL_IDENTITY_STATUSES,
  GlobalDigitalSignalSchema,
  SignalValueSchema,
  STORAGE_POLICIES,
} from "../global-signal";
import { WEBSITE_SIGNAL_STATUSES, WEBSITE_CLAIMABILITIES, WebsiteDigitalSignalSchema } from "../signal";

function globalSignal(overrides: Record<string, unknown> = {}) {
  return {
    key: "some_signal",
    value: { type: "string", value: "値" },
    status: "observed",
    identity: "target_match",
    claimability: "FACT_SAFE",
    provenance: "some_other_collector_v1",
    source_urls: ["https://example.com/"],
    observed_at: new Date().toISOString(),
    ...overrides,
  };
}

describe("global contract(契約 Part A)", () => {
  it("SignalValue は 8 variants を保持する", () => {
    const types = ["boolean", "string", "number", "url", "date", "string_list", "url_list", "none"];
    for (const type of types) {
      const sample =
        type === "none"
          ? { type }
          : type === "boolean"
            ? { type, value: true }
            : type === "number"
              ? { type, value: 1 }
              : type === "url"
                ? { type, value: "https://example.com/" }
                : type === "date"
                  ? { type, value: "2026-08-05" }
                  : type === "string_list"
                    ? { type, value: ["a"] }
                    : type === "url_list"
                      ? { type, value: ["https://example.com/"] }
                      : { type, value: "s" };
      expect(SignalValueSchema.safeParse(sample).success).toBe(true);
    }
  });

  it("status は 5 値(absent_confirmed / not_applicable を含む)", () => {
    expect([...GLOBAL_SIGNAL_STATUSES].sort()).toEqual(
      ["absent_confirmed", "inaccessible", "not_applicable", "not_observed", "observed"].sort(),
    );
  });

  it("claimability は 4 値(QUESTION_ONLY を含む)", () => {
    expect([...GLOBAL_CLAIMABILITIES].sort()).toEqual(
      ["DO_NOT_USE", "FACT_SAFE", "INTERNAL_ONLY", "QUESTION_ONLY"].sort(),
    );
  });

  it("claimability rank は DO_NOT_USE < INTERNAL_ONLY < QUESTION_ONLY < FACT_SAFE", () => {
    expect(GLOBAL_CLAIMABILITY_RANK.DO_NOT_USE).toBeLessThan(GLOBAL_CLAIMABILITY_RANK.INTERNAL_ONLY);
    expect(GLOBAL_CLAIMABILITY_RANK.INTERNAL_ONLY).toBeLessThan(GLOBAL_CLAIMABILITY_RANK.QUESTION_ONLY);
    expect(GLOBAL_CLAIMABILITY_RANK.QUESTION_ONLY).toBeLessThan(GLOBAL_CLAIMABILITY_RANK.FACT_SAFE);
  });

  it("identity status は 5 値", () => {
    expect([...GLOBAL_IDENTITY_STATUSES].sort()).toEqual(
      ["candidate_known_url", "target_match", "trusted_manual", "uncertain", "unrelated"].sort(),
    );
  });

  it("storage policy は 4 値", () => {
    expect([...STORAGE_POLICIES].sort()).toEqual(
      ["derived_existing_only", "persist_allowed", "prohibited", "read_through_only"].sort(),
    );
  });

  it("global schema は absent_confirmed / not_applicable を受理する", () => {
    for (const status of ["absent_confirmed", "not_applicable"]) {
      const result = GlobalDigitalSignalSchema.safeParse(
        globalSignal({ status, value: { type: "none" } }),
      );
      expect(result.success).toBe(true);
    }
  });

  it("global schema は QUESTION_ONLY を受理する", () => {
    expect(GlobalDigitalSignalSchema.safeParse(globalSignal({ claimability: "QUESTION_ONLY" })).success).toBe(
      true,
    );
  });

  it("global schema は website_scanner_v1 以外の provenance を受理する", () => {
    expect(GlobalDigitalSignalSchema.safeParse(globalSignal({ provenance: "ai_research_v1" })).success).toBe(
      true,
    );
  });

  it("global schema でも observed ⇔ value.type !== none の不変条件は保たれる", () => {
    expect(GlobalDigitalSignalSchema.safeParse(globalSignal({ value: { type: "none" } })).success).toBe(false);
    expect(
      GlobalDigitalSignalSchema.safeParse(globalSignal({ status: "not_observed" })).success,
    ).toBe(false);
  });
});

describe("global と Website subset の関係", () => {
  it("Website subset の status は global の真部分集合(3 < 5)", () => {
    expect(WEBSITE_SIGNAL_STATUSES.length).toBe(3);
    expect(GLOBAL_SIGNAL_STATUSES.length).toBe(5);
    for (const s of WEBSITE_SIGNAL_STATUSES) {
      expect(GLOBAL_SIGNAL_STATUSES).toContain(s);
    }
  });

  it("Website subset の claimability は global の真部分集合(3 < 4)", () => {
    expect(WEBSITE_CLAIMABILITIES.length).toBe(3);
    expect(GLOBAL_CLAIMABILITIES.length).toBe(4);
    for (const c of WEBSITE_CLAIMABILITIES) {
      expect(GLOBAL_CLAIMABILITIES).toContain(c);
    }
  });

  it("global で有効な値が Website schema では拒否される(subset であることの実証)", () => {
    const websiteBase = { ...globalSignal(), provenance: "website_scanner_v1" };

    // global では有効
    expect(
      GlobalDigitalSignalSchema.safeParse({
        ...websiteBase,
        status: "absent_confirmed",
        value: { type: "none" },
      }).success,
    ).toBe(true);
    // Website subset では拒否
    expect(
      WebsiteDigitalSignalSchema.safeParse({
        ...websiteBase,
        status: "absent_confirmed",
        value: { type: "none" },
      }).success,
    ).toBe(false);

    expect(GlobalDigitalSignalSchema.safeParse({ ...websiteBase, claimability: "QUESTION_ONLY" }).success).toBe(
      true,
    );
    expect(
      WebsiteDigitalSignalSchema.safeParse({ ...websiteBase, claimability: "QUESTION_ONLY" }).success,
    ).toBe(false);
  });
});
