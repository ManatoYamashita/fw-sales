/**
 * Sparse store の source identity 回復を **経路全体**で固定する統合テスト
 * (PR #180 Sparse Store Source Identity Recovery)。
 *
 * 実機 run(告膳、`research_run_msrrwzdf_ws1i5t`)の再現:
 *
 * ```
 * stores.address = ""  /  stores.phone = ""
 *   → isTargetStoreMatch の「住所一致 OR 電話一致」が構造的に不成立
 *   → 10 source 中 9 件が url_context_status="success" でも target_match が 0 件
 *   → 53 項目中 19 項目が not_found へ降格
 * ```
 *
 * 本テストは
 *
 * ```
 * Stage0 Text Search strong match (Places をモック)
 *   → verifiedIdentity
 *   → buildSourceVerificationTarget (missing-only enrichment)
 *   → applySourceIdentityVerification
 *   → identity_status = target_match
 *   → isVerifiedSourceForItem
 *   → validateResearchItemStatus で confirmed 維持
 * ```
 *
 * までを**すべて実コード**で通す。Gemini / Google Places の live call は行わない。
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

const { mockGetPlaceById, mockSearchPlaces } = vi.hoisted(() => ({
  mockGetPlaceById: vi.fn(),
  mockSearchPlaces: vi.fn(),
}));

vi.mock("@/lib/places/google", () => ({
  getPlaceById: mockGetPlaceById,
  searchPlaces: mockSearchPlaces,
}));

// Gemini クライアントは経路上使わないが、`pipeline.ts` の静的 import を満たすためモックする。
vi.mock("../client", () => ({
  createResearchGeminiClient: () => ({
    runSourceDiscovery: vi.fn(),
    runStructuredUrlContext: vi.fn(),
  }),
}));

const { runStage0PlacesResync } = await import("../places-stage0");
const { buildPlacesSearchIdentity } = await import("../places-search-identity");
const { applySourceIdentityVerification, buildSourceVerificationTarget } = await import(
  "../pipeline"
);
const { isVerifiedSourceForItem, validateResearchItemStatus } = await import(
  "@/lib/ai/research-result-schema"
);

import type { SourceRegistryEntry, ResearchItem } from "@/lib/ai/research-result-schema";
import type { SourceVerification } from "@/types/research-run";

const NOW = "2026-08-14T00:00:00.000Z";

/** 告膳: スカラー住所・電話が空で、prefecture/city 側に番地がある。 */
const SPARSE_STORE = {
  name: "告膳",
  prefecture: "埼玉県",
  city: "所沢市日吉町19-12",
  address: "",
  phone: "",
  genre: "和食",
};

const MATCHED_PLACE = {
  placeId: "places/kokuzen",
  name: "告膳",
  formattedAddress: "日本、〒359-1123 埼玉県所沢市日吉町１９−１２",
  lat: 35.79,
  lng: 139.46,
  phone: "04-2998-6543",
  rating: 4.2,
  userRatingsTotal: 40,
  types: ["japanese_restaurant", "restaurant"],
  googleMapsUri: null,
};

const HOTPEPPER_ENTRY = {
  id: "S01",
  title: "告膳(所沢駅/和食) - ホットペッパーグルメ",
  grounding_redirect_url:
    "https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc",
  resolved_url: null,
  resolve_status: "skipped",
  source_type: "gourmet_site",
  discovery_provenance: "gemini_search_candidate",
  url_context_status: "success",
  identity_status: "not_checked",
} as unknown as SourceRegistryEntry;

function verification(over: Partial<SourceVerification> = {}): SourceVerification[] {
  return [
    {
      source_id: "S01",
      relation: "target_store",
      observed_title: "告膳",
      observed_name: "告膳",
      observed_address: null,
      observed_phone: null,
      note: "",
      ...over,
    } as SourceVerification,
  ];
}

const ITEM: ResearchItem = {
  key: "business_hours_holidays",
  research_policy: "FACT",
  status: "confirmed",
  value: "11:30-14:00 / 17:30-22:00",
  evidence: "ホットペッパーの店舗ページに記載",
  source_ids: ["S01"],
};

beforeEach(() => {
  mockGetPlaceById.mockReset();
  mockSearchPlaces.mockReset();
});

/** Store → Stage0 → verification target → identity_status までを実コードで通す。 */
async function runIdentityPath(
  store: typeof SPARSE_STORE,
  verifications: SourceVerification[],
) {
  const placesSearchIdentity = buildPlacesSearchIdentity(store);
  const stage0 = await runStage0PlacesResync({
    googlePlaceId: null,
    store: placesSearchIdentity,
    now: NOW,
  });
  const target = buildSourceVerificationTarget(store, stage0.verifiedIdentity);
  const registry = applySourceIdentityVerification([HOTPEPPER_ENTRY], verifications, target);
  return { stage0, target, entry: registry[0]! };
}

describe("sparse store identity recovery (end-to-end, no live API)", () => {
  it("Stage0 strong match → 観測住所一致 → target_match → confirmed 維持", async () => {
    mockSearchPlaces.mockResolvedValue([MATCHED_PLACE]);

    const { stage0, target, entry } = await runIdentityPath(
      SPARSE_STORE,
      verification({ observed_address: "埼玉県所沢市日吉町19-12" }),
    );

    // Stage0 が anchor を返している
    expect(stage0.diagnostic.path).toBe("text_search");
    expect(stage0.diagnostic.outcome).toBe("matched");
    expect(stage0.verifiedIdentity).not.toBeNull();

    // missing-only enrichment: 空だった address / phone だけが補完された
    expect(target.name).toBe("告膳");
    expect(target.address).toBe(MATCHED_PLACE.formattedAddress);
    expect(target.phone).toBe(MATCHED_PLACE.phone);

    // identity_status が target_match になる
    expect(entry.identity_status).toBe("target_match");

    // trust boundary を通り、confirmed が維持される
    expect(isVerifiedSourceForItem(entry, ITEM.key)).toBe(true);
    const validated = validateResearchItemStatus(ITEM, { sourceRegistry: [entry] });
    expect(validated.status).toBe("confirmed");
    expect(validated.value).toBe(ITEM.value);
    expect(validated.warning ?? "").not.toContain("格下げ");
  });

  it("観測電話一致でも target_match になる", async () => {
    mockSearchPlaces.mockResolvedValue([MATCHED_PLACE]);
    const { entry } = await runIdentityPath(
      SPARSE_STORE,
      verification({ observed_phone: "04-2998-6543" }),
    );
    expect(entry.identity_status).toBe("target_match");
  });

  it("修正前の状態(anchor 無し)では uncertain のまま not_found へ降格する", async () => {
    // prefecture/city も空 → Stage0 が strong match できない = 修正前と同じ入力状態。
    mockSearchPlaces.mockResolvedValue([MATCHED_PLACE]);
    const { stage0, entry } = await runIdentityPath(
      { ...SPARSE_STORE, prefecture: "", city: "" },
      verification({ observed_address: "埼玉県所沢市日吉町19-12" }),
    );

    expect(stage0.verifiedIdentity).toBeNull();
    expect(entry.identity_status).toBe("uncertain");
    expect(isVerifiedSourceForItem(entry, ITEM.key)).toBe(false);

    const validated = validateResearchItemStatus(ITEM, { sourceRegistry: [entry] });
    expect(validated.status).toBe("not_found");
    // 本文取得には成功しているので、同定失敗の文言になる。
    expect(validated.warning).toContain("対象店舗のページであることを確認できなかった");
  });

  it("観測住所も電話も無ければ anchor があっても uncertain(名前だけで昇格しない)", async () => {
    mockSearchPlaces.mockResolvedValue([MATCHED_PLACE]);
    const { entry } = await runIdentityPath(SPARSE_STORE, verification());
    expect(entry.identity_status).toBe("uncertain");
    expect(isVerifiedSourceForItem(entry, ITEM.key)).toBe(false);
  });

  it("別番地の観測住所なら anchor があっても uncertain", async () => {
    mockSearchPlaces.mockResolvedValue([MATCHED_PLACE]);
    const { entry } = await runIdentityPath(
      SPARSE_STORE,
      verification({ observed_address: "埼玉県所沢市日吉町2-3" }),
    );
    expect(entry.identity_status).toBe("uncertain");
  });

  it("既存 address を持つ店舗では anchor が使われず、従来の判定が維持される", async () => {
    mockSearchPlaces.mockResolvedValue([MATCHED_PLACE]);
    // Issue #215 で anchor は prefecture / city / address の3列から合成するように
    // なったため、3列が整合した実在しうる形状で固定する(元は address だけを
    // 別県の住所へ差し替えており、県と住所が矛盾する非現実的な形状だった)。
    const storeWithAddress = {
      ...SPARSE_STORE,
      prefecture: "千葉県",
      city: "柏市",
      address: "千葉県柏市旭町1-1-12",
    };
    const { target, entry } = await runIdentityPath(
      storeWithAddress,
      verification({ observed_address: "埼玉県所沢市日吉町19-12" }),
    );
    // 既存値が anchor になる(fresh Places で上書きしない)
    expect(target.address).toBe("千葉県柏市旭町1-1-12");
    // したがって別住所の観測は一致せず uncertain
    expect(entry.identity_status).toBe("uncertain");
  });
});
