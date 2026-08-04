import { describe, expect, it } from "vitest";
import {
  WEBSITE_SIGNAL_DEFS,
  WEBSITE_SIGNAL_KEYS,
  WEBSITE_SIGNAL_DEFS_BY_KEY,
  STORAGE_POLICIES,
} from "../website-signal-defs";
import { WEBSITE_CLAIMABILITIES } from "../signal";

describe("WEBSITE_SIGNAL_DEFS", () => {
  it("ちょうど16件", () => {
    expect(WEBSITE_SIGNAL_DEFS.length).toBe(16);
    expect(WEBSITE_SIGNAL_KEYS.length).toBe(16);
  });

  it("keyの重複が無い", () => {
    const keys = WEBSITE_SIGNAL_DEFS.map((d) => d.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("WEBSITE_SIGNAL_KEYS と1:1対応する", () => {
    const defKeys = new Set(WEBSITE_SIGNAL_DEFS.map((d) => d.key));
    for (const key of WEBSITE_SIGNAL_KEYS) {
      expect(defKeys.has(key)).toBe(true);
    }
  });

  it("全てのdefault_claimabilityがWebsite Scanner subsetの3値のいずれか", () => {
    for (const def of WEBSITE_SIGNAL_DEFS) {
      expect(WEBSITE_CLAIMABILITIES).toContain(def.default_claimability);
    }
  });

  it("全てのstorage_policyがpersist_allowed(V1は全signalがこれ)", () => {
    for (const def of WEBSITE_SIGNAL_DEFS) {
      expect(def.storage_policy).toBe("persist_allowed");
    }
  });

  it("storage_policy はグローバル契約の4値を保持する(削除しない)", () => {
    expect([...STORAGE_POLICIES].sort()).toEqual(
      ["derived_existing_only", "persist_allowed", "prohibited", "read_through_only"].sort(),
    );
  });

  it("website_canonical / website_jsonld_types は既定 INTERNAL_ONLY", () => {
    expect(WEBSITE_SIGNAL_DEFS_BY_KEY.get("website_canonical")?.default_claimability).toBe("INTERNAL_ONLY");
    expect(WEBSITE_SIGNAL_DEFS_BY_KEY.get("website_jsonld_types")?.default_claimability).toBe("INTERNAL_ONLY");
  });

  it("value_typeは全て none 以外", () => {
    for (const def of WEBSITE_SIGNAL_DEFS) {
      expect(def.value_type).not.toBe("none");
    }
  });
});
