import { describe, expect, it } from "vitest";
import { deriveClaimability, weakest, ALL_WEBSITE_CLAIMABILITIES, ALL_WEBSITE_IDENTITY_STATUSES } from "../claimability";
import { WEBSITE_SIGNAL_STATUSES, type WebsiteSignalStatus, type WebsiteClaimability } from "../signal";
import type { WebsiteIdentityStatus } from "../identity";

describe("weakest", () => {
  it("最も弱い値を返す", () => {
    expect(weakest("FACT_SAFE", "INTERNAL_ONLY", "DO_NOT_USE")).toBe("DO_NOT_USE");
    expect(weakest("FACT_SAFE", "INTERNAL_ONLY")).toBe("INTERNAL_ONLY");
    expect(weakest("FACT_SAFE")).toBe("FACT_SAFE");
  });
});

describe("deriveClaimability", () => {
  it("observed + target_match のときのみ FACT_SAFE に到達できる", () => {
    expect(deriveClaimability("FACT_SAFE", "observed", "target_match")).toBe("FACT_SAFE");
    expect(deriveClaimability("FACT_SAFE", "observed", "trusted_manual")).toBe("FACT_SAFE");
  });

  it("candidate_known_url は observed でも FACT_SAFE にならない", () => {
    for (const status of WEBSITE_SIGNAL_STATUSES) {
      expect(deriveClaimability("FACT_SAFE", status, "candidate_known_url")).not.toBe("FACT_SAFE");
    }
  });

  it("uncertain は observed でも FACT_SAFE にならない", () => {
    for (const status of WEBSITE_SIGNAL_STATUSES) {
      expect(deriveClaimability("FACT_SAFE", status, "uncertain")).not.toBe("FACT_SAFE");
    }
  });

  it("unrelated は常に DO_NOT_USE", () => {
    for (const status of WEBSITE_SIGNAL_STATUSES) {
      expect(deriveClaimability("FACT_SAFE", status, "unrelated")).toBe("DO_NOT_USE");
    }
  });

  it("inaccessible は identity に関わらず常に DO_NOT_USE", () => {
    for (const identity of ALL_WEBSITE_IDENTITY_STATUSES) {
      expect(deriveClaimability("FACT_SAFE", "inaccessible", identity)).toBe("DO_NOT_USE");
    }
  });

  it("not_observed は最大でも INTERNAL_ONLY", () => {
    for (const identity of ALL_WEBSITE_IDENTITY_STATUSES) {
      const result = deriveClaimability("FACT_SAFE", "not_observed", identity);
      expect(result === "FACT_SAFE").toBe(false);
    }
  });

  it("default claimability が INTERNAL_ONLY なら observed + target_match でも FACT_SAFE を超えない", () => {
    expect(deriveClaimability("INTERNAL_ONLY", "observed", "target_match")).toBe("INTERNAL_ONLY");
  });

  it("3 status × 5 identity の全組合せで DO_NOT_USE/INTERNAL_ONLY/FACT_SAFE 以外を返さない", () => {
    for (const status of WEBSITE_SIGNAL_STATUSES) {
      for (const identity of ALL_WEBSITE_IDENTITY_STATUSES) {
        const result = deriveClaimability("FACT_SAFE", status, identity);
        expect(ALL_WEBSITE_CLAIMABILITIES).toContain(result);
      }
    }
  });

  it("全組合せの実測値を固定する(回帰テスト)", () => {
    const expected: Record<WebsiteSignalStatus, Record<WebsiteIdentityStatus, WebsiteClaimability>> = {
      observed: {
        candidate_known_url: "INTERNAL_ONLY",
        trusted_manual: "FACT_SAFE",
        target_match: "FACT_SAFE",
        uncertain: "INTERNAL_ONLY",
        unrelated: "DO_NOT_USE",
      },
      not_observed: {
        candidate_known_url: "INTERNAL_ONLY",
        trusted_manual: "INTERNAL_ONLY",
        target_match: "INTERNAL_ONLY",
        uncertain: "INTERNAL_ONLY",
        unrelated: "DO_NOT_USE",
      },
      inaccessible: {
        candidate_known_url: "DO_NOT_USE",
        trusted_manual: "DO_NOT_USE",
        target_match: "DO_NOT_USE",
        uncertain: "DO_NOT_USE",
        unrelated: "DO_NOT_USE",
      },
    };

    for (const status of WEBSITE_SIGNAL_STATUSES) {
      for (const identity of ALL_WEBSITE_IDENTITY_STATUSES) {
        expect(deriveClaimability("FACT_SAFE", status, identity)).toBe(expected[status][identity]);
      }
    }
  });
});
