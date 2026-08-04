import { describe, expect, it } from "vitest";
import {
  classifyBookingDestination,
  selectRepresentativeBooking,
  BOOKING_DESTINATION_TYPES,
  BOOKING_PROVIDER_PORTAL_KINDS,
} from "../booking";

const ORIGIN = "https://example-restaurant.com";

describe("classifyBookingDestination", () => {
  it("同一originはdirect_first_party", () => {
    const r = classifyBookingDestination("https://example-restaurant.com/reserve", ORIGIN);
    expect(r.destination_type).toBe("direct_first_party");
  });

  it("同一hostのサブドメインもdirect_first_party", () => {
    const r = classifyBookingDestination("https://reserve.example-restaurant.com/x", ORIGIN);
    expect(r.destination_type).toBe("direct_first_party");
  });

  it("各providerを正しく分類する", () => {
    expect(classifyBookingDestination("https://tabelog.com/x", ORIGIN).destination_type).toBe("tabelog");
    expect(classifyBookingDestination("https://hotpepper.jp/x", ORIGIN).destination_type).toBe("hotpepper");
    expect(classifyBookingDestination("https://gnavi.co.jp/x", ORIGIN).destination_type).toBe("gnavi");
    expect(classifyBookingDestination("https://retty.me/x", ORIGIN).destination_type).toBe("retty");
    expect(classifyBookingDestination("https://tablecheck.com/x", ORIGIN).destination_type).toBe(
      "tablecheck",
    );
    expect(classifyBookingDestination("https://ebica.jp/x", ORIGIN).destination_type).toBe("ebica");
    expect(classifyBookingDestination("https://ikyu.com/x", ORIGIN).destination_type).toBe("ikyu");
    expect(classifyBookingDestination("https://ozmall.co.jp/x", ORIGIN).destination_type).toBe("ozmall");
    expect(classifyBookingDestination("https://reserve.google.com/x", ORIGIN).destination_type).toBe(
      "google",
    );
  });

  it("サブドメインでも正しく分類する", () => {
    expect(classifyBookingDestination("https://s.tabelog.com/x", ORIGIN).destination_type).toBe("tabelog");
  });

  it("詐称ホスト(tabelog.com.evil.jp)をtabelogと誤判定しない", () => {
    const r = classifyBookingDestination("https://tabelog.com.evil.jp/x", ORIGIN);
    expect(r.destination_type).not.toBe("tabelog");
    expect(r.destination_type).toBe("other_external");
  });

  it("未知の外部ホストはother_external", () => {
    const r = classifyBookingDestination("https://unknown-booking-site.example/x", ORIGIN);
    expect(r.destination_type).toBe("other_external");
  });

  it("パース不能なリンクはunknown", () => {
    const r = classifyBookingDestination("not a url", ORIGIN);
    expect(r.destination_type).toBe("unknown");
  });

  it("BOOKING_DESTINATION_TYPES は phone_only を含まない(CC-3)", () => {
    expect(BOOKING_DESTINATION_TYPES).not.toContain("phone_only");
  });

  it("BOOKING_PROVIDER_PORTAL_KINDS はsocial系(instagram/facebook/x/line)を含まない", () => {
    expect(BOOKING_PROVIDER_PORTAL_KINDS).not.toContain("instagram");
    expect(BOOKING_PROVIDER_PORTAL_KINDS).not.toContain("facebook");
    expect(BOOKING_PROVIDER_PORTAL_KINDS).not.toContain("x");
    expect(BOOKING_PROVIDER_PORTAL_KINDS).not.toContain("line");
  });
});

describe("selectRepresentativeBooking", () => {
  it("空配列はnull", () => {
    expect(selectRepresentativeBooking([], ORIGIN)).toBeNull();
  });

  it("direct_first_partyが存在すればそれを優先する", () => {
    const r = selectRepresentativeBooking(
      ["https://tabelog.com/x", "https://example-restaurant.com/reserve"],
      ORIGIN,
    );
    expect(r?.destination_type).toBe("direct_first_party");
  });

  it("direct_first_partyが無ければ既知providerを優先する", () => {
    const r = selectRepresentativeBooking(
      ["https://unknown.example/x", "https://tabelog.com/x"],
      ORIGIN,
    );
    expect(r?.destination_type).toBe("tabelog");
  });

  it("同順位なら先に現れたものを残す(決定性)", () => {
    const r = selectRepresentativeBooking(["https://tabelog.com/a", "https://hotpepper.jp/b"], ORIGIN);
    expect(r?.destination_type).toBe("tabelog");
  });
});
