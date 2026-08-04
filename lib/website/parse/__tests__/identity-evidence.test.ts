import { describe, expect, it } from "vitest";
import { buildIdentityEvidence, dedupeCandidates, normalizeForDedup } from "../identity-evidence";
import type { JsonLdIdentityNode } from "../json-ld";
import type { IdentityCandidate } from "../../contract/identity";

const SOURCE = "https://example.com/";

function strongNode(overrides: Partial<JsonLdIdentityNode> = {}): JsonLdIdentityNode {
  return { strength: "strong", name: "テスト食堂", address: "東京都渋谷区1-1-1", telephone: "03-1111-2222", sameAs: [], ...overrides };
}

describe("normalizeForDedup", () => {
  it("全角/半角・大文字小文字・空白を統一する", () => {
    expect(normalizeForDedup("テスト 食堂")).toBe(normalizeForDedup("テスト食堂"));
    expect(normalizeForDedup("ＡＢＣ")).toBe(normalizeForDedup("ABC"));
    expect(normalizeForDedup("ABC")).toBe(normalizeForDedup("abc"));
  });
});

describe("dedupeCandidates", () => {
  it("同一正規化値のうちstrengthが強い方を残す", () => {
    const candidates: IdentityCandidate[] = [
      { value: "テスト食堂", strength: "weak", source_url: SOURCE, provenance: "h1" },
      { value: "テスト食堂", strength: "strong", source_url: SOURCE, provenance: "json_ld_strong_entity" },
    ];
    const result = dedupeCandidates(candidates);
    expect(result).toHaveLength(1);
    expect(result[0]?.strength).toBe("strong");
  });

  it("strongが先でweakが後でもstrongを残す", () => {
    const candidates: IdentityCandidate[] = [
      { value: "テスト食堂", strength: "strong", source_url: SOURCE, provenance: "json_ld_strong_entity" },
      { value: "テスト食堂", strength: "weak", source_url: SOURCE, provenance: "h1" },
    ];
    const result = dedupeCandidates(candidates);
    expect(result).toHaveLength(1);
    expect(result[0]?.strength).toBe("strong");
  });

  it("空文字valueは除外する", () => {
    const candidates: IdentityCandidate[] = [
      { value: "  ", strength: "weak", source_url: SOURCE, provenance: "h1" },
    ];
    expect(dedupeCandidates(candidates)).toHaveLength(0);
  });

  it("異なる値は両方保持する", () => {
    const candidates: IdentityCandidate[] = [
      { value: "テスト食堂", strength: "strong", source_url: SOURCE, provenance: "json_ld_strong_entity" },
      { value: "テスト運営会社", strength: "weak", source_url: SOURCE, provenance: "json_ld_organization" },
    ];
    expect(dedupeCandidates(candidates)).toHaveLength(2);
  });
});

describe("buildIdentityEvidence", () => {
  it("strong JSON-LD nodeからname/address/phoneをstrong evidenceとして抽出する", () => {
    const evidence = buildIdentityEvidence({
      identityNodes: [strongNode()],
      h1: null,
      title: null,
      phoneLinks: [],
      sourceUrl: SOURCE,
    });
    expect(evidence.names).toEqual([
      { value: "テスト食堂", strength: "strong", source_url: SOURCE, provenance: "json_ld_strong_entity" },
    ]);
    expect(evidence.addresses[0]?.strength).toBe("strong");
    expect(evidence.phones[0]?.strength).toBe("strong");
  });

  it("Organization nodeのname/address/phoneは全てweak", () => {
    const evidence = buildIdentityEvidence({
      identityNodes: [
        { strength: "weak", name: "運営株式会社", address: "本社住所", telephone: "03-9999-8888", sameAs: [] },
      ],
      h1: null,
      title: null,
      phoneLinks: [],
      sourceUrl: SOURCE,
    });
    expect(evidence.names[0]?.strength).toBe("weak");
    expect(evidence.names[0]?.provenance).toBe("json_ld_organization");
    expect(evidence.addresses[0]?.strength).toBe("weak");
    expect(evidence.phones[0]?.strength).toBe("weak");
  });

  it("h1とtitleはweakなname evidenceとして追加される", () => {
    const evidence = buildIdentityEvidence({
      identityNodes: [],
      h1: "テスト食堂 渋谷店",
      title: "テスト食堂 | 公式サイト",
      phoneLinks: [],
      sourceUrl: SOURCE,
    });
    expect(evidence.names).toHaveLength(2);
    expect(evidence.names.every((n) => n.strength === "weak")).toBe(true);
    expect(evidence.names.map((n) => n.provenance).sort()).toEqual(["h1", "title"]);
  });

  it("tel:リンクはweakなphone evidenceとして追加される", () => {
    const evidence = buildIdentityEvidence({
      identityNodes: [],
      h1: null,
      title: null,
      phoneLinks: ["0311112222", "0333334444"],
      sourceUrl: SOURCE,
    });
    expect(evidence.phones).toHaveLength(2);
    expect(evidence.phones.every((p) => p.strength === "weak" && p.provenance === "tel_link")).toBe(true);
  });

  it("addressのweak evidenceにはaddress evidenceが空のOrganizationでも影響しない(nullは追加しない)", () => {
    const evidence = buildIdentityEvidence({
      identityNodes: [{ strength: "weak", name: "運営会社", address: null, telephone: null, sameAs: [] }],
      h1: null,
      title: null,
      phoneLinks: [],
      sourceUrl: SOURCE,
    });
    expect(evidence.addresses).toHaveLength(0);
    expect(evidence.phones).toHaveLength(0);
  });

  it("複数ソースからの重複name(strong優先)をdedupeする", () => {
    const evidence = buildIdentityEvidence({
      identityNodes: [strongNode({ name: "テスト食堂" })],
      h1: "テスト食堂",
      title: "テスト食堂 - 公式",
      phoneLinks: [],
      sourceUrl: SOURCE,
    });
    // h1由来の"テスト食堂"はstrong JSON-LD由来の同一値とdedupeされ、strongが残る
    const matching = evidence.names.filter((n) => normalizeForDedup(n.value) === normalizeForDedup("テスト食堂"));
    expect(matching).toHaveLength(1);
    expect(matching[0]?.strength).toBe("strong");
  });
});
