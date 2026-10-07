import { describe, expect, it } from "vitest";
import { extractStoreIdFromLink } from "../notification-link";

describe("extractStoreIdFromLink (#296)", () => {
  it.each([
    ["/stores/store_mq2cp4xx_3jsm2b#deep-research", "store_mq2cp4xx_3jsm2b"],
    ["/stores/store_005", "store_005"],
    ["/stores/store_005?tab=deals", "store_005"],
    ["/stores/store%20x", "store x"],
  ])("%s → %s", (link, expected) => {
    expect(extractStoreIdFromLink(link)).toBe(expected);
  });

  it.each([
    [null],
    [""],
    ["/stores"],
    ["/stores/"],
    ["/stores/new"],
    ["/stores/store_005/edit"],
    ["/research/store_005"],
    ["https://example.com/stores/store_005"],
    ["/stores/%E0%A4%A"],
  ])("店舗詳細ではないリンク %s は null", (link) => {
    expect(extractStoreIdFromLink(link)).toBeNull();
  });
});
