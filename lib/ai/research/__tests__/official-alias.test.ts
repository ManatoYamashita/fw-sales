/**
 * official alias 統合の単体検証
 * (feat/ai-research-quality-ux-hardening、Plan §8.2 / 承認レビュー指摘2)。
 *
 * ## 何を解決するか(Q5)
 *
 * 同一ページが Source Registry 上で2エントリに分裂すると、
 * - S01(known_store_data / official_site / 未取得)は **一次情報性**を持つが本文未取得
 * - S02(gemini_search_candidate / grounding redirect / 取得済み)はその逆
 * となり、`validateResearchItemStatus` の path2 が両方を1エントリに要求するため
 * **2つ合わせれば条件を満たしているのにどちらも単独では満たさない**。
 * 結果として `concept` 等の一次情報必須4項目が hearing_required に降格していた。
 *
 * ## trust boundary を緩めないための条件(すべて AND)
 *
 * 1. resolver が resolved を返した
 * 2. **final HTTP status が 2xx**
 * 3. safe normalization(`url-normalize.ts`、www除去・origin-only match をしない)
 * 4. known official URL と**厳格一致**
 *
 * ひとつでも欠ければ統合せず、従来の trust boundary へ安全側 fallback する。
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SourceRegistryEntry } from "@/types/research-run";

vi.mock("server-only", () => ({}));

const { mockResolve } = vi.hoisted(() => ({ mockResolve: vi.fn() }));

vi.mock("../source-url-resolver", () => ({
  resolveGroundingRedirectUrl: mockResolve,
}));

const { resolveOfficialAliases } = await import("../official-alias");

const KNOWN_URL = "https://robata-jun.com/";
const REDIRECT = "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZ123";

function knownEntry(): SourceRegistryEntry {
  return {
    id: "S01",
    title: "公式サイト(登録情報)",
    grounding_redirect_url: KNOWN_URL,
    resolved_url: null,
    resolve_status: "skipped",
    source_type: "official_site",
    discovery_provenance: "known_store_data",
    url_context_status: "not_attempted",
  };
}

function candidateEntry(overrides: Partial<SourceRegistryEntry> = {}): SourceRegistryEntry {
  return {
    id: "S02",
    title: "【公式】東北メシ炉端ジュン",
    grounding_redirect_url: REDIRECT,
    resolved_url: null,
    resolve_status: "skipped",
    source_type: "official_site",
    discovery_provenance: "gemini_search_candidate",
    url_context_status: "not_attempted",
    ...overrides,
  };
}

beforeEach(() => {
  mockResolve.mockReset();
});

describe("resolveOfficialAliases — 統合する条件", () => {
  it("resolved + final 2xx + 厳格一致 なら候補を破棄しknown_store_dataへ統合する", async () => {
    mockResolve.mockResolvedValue({ status: "resolved", url: KNOWN_URL, finalStatus: 200 });

    const result = await resolveOfficialAliases({
      registry: [knownEntry(), candidateEntry()],
      knownOfficialUrls: [KNOWN_URL],
    });

    expect(result.mergedCount).toBe(1);
    expect(result.registry).toHaveLength(1);
    expect(result.registry[0]!.discovery_provenance).toBe("known_store_data");
    expect(result.registry[0]!.source_type).toBe("official_site");
    expect(result.registry[0]!.grounding_redirect_url).toBe(KNOWN_URL);
  });

  it("統合後にidを先頭から採番し直す(Stage2プロンプトへ渡す前)", async () => {
    // 候補ごとに別の解決先を返す(片方だけaliasになるケース)。
    mockResolve.mockImplementation((url: string) =>
      Promise.resolve(
        url === REDIRECT
          ? { status: "resolved", url: KNOWN_URL, finalStatus: 200 }
          : { status: "resolved", url: "https://tabelog.com/xyz/", finalStatus: 200 },
      ),
    );
    const other: SourceRegistryEntry = {
      ...candidateEntry({ id: "S03", grounding_redirect_url: `${REDIRECT}x` }),
      source_type: "gourmet_site",
    };

    const result = await resolveOfficialAliases({
      registry: [knownEntry(), candidateEntry(), other],
      knownOfficialUrls: [KNOWN_URL],
    });

    expect(result.registry.map((e) => e.id)).toEqual(["S01", "S02"]);
  });

  it("normalizationで吸収できる差(末尾slash/case/fragment)は厳格一致とみなす", async () => {
    mockResolve.mockResolvedValue({
      status: "resolved",
      url: "HTTPS://Robata-Jun.COM#top",
      finalStatus: 204,
    });

    const result = await resolveOfficialAliases({
      registry: [knownEntry(), candidateEntry()],
      knownOfficialUrls: [KNOWN_URL],
    });
    expect(result.mergedCount).toBe(1);
  });
});

describe("resolveOfficialAliases — 統合しない条件(安全側fallback)", () => {
  it("known official URLが0件ならresolverを1回も呼ばない", async () => {
    const result = await resolveOfficialAliases({
      registry: [candidateEntry()],
      knownOfficialUrls: [],
    });
    expect(mockResolve).not.toHaveBeenCalled();
    expect(result.registry).toHaveLength(1);
    expect(result.mergedCount).toBe(0);
  });

  it("final HTTP statusが4xx/5xxなら統合しない(承認レビュー指摘2)", async () => {
    mockResolve.mockResolvedValue({ status: "resolved", url: KNOWN_URL, finalStatus: 404 });
    const notFound = await resolveOfficialAliases({
      registry: [knownEntry(), candidateEntry()],
      knownOfficialUrls: [KNOWN_URL],
    });
    expect(notFound.mergedCount).toBe(0);
    expect(notFound.registry).toHaveLength(2);

    mockResolve.mockResolvedValue({ status: "resolved", url: KNOWN_URL, finalStatus: 503 });
    const serverError = await resolveOfficialAliases({
      registry: [knownEntry(), candidateEntry()],
      knownOfficialUrls: [KNOWN_URL],
    });
    expect(serverError.mergedCount).toBe(0);
  });

  it("resolver failureなら統合せずregistryを変更しない", async () => {
    mockResolve.mockResolvedValue({ status: "failed", reason: "timeout" });
    const result = await resolveOfficialAliases({
      registry: [knownEntry(), candidateEntry()],
      knownOfficialUrls: [KNOWN_URL],
    });
    expect(result.mergedCount).toBe(0);
    expect(result.registry).toHaveLength(2);
  });

  it("resolverがrejectしても例外を投げずregistryをそのまま返す", async () => {
    mockResolve.mockRejectedValue(new Error("boom"));
    const result = await resolveOfficialAliases({
      registry: [knownEntry(), candidateEntry()],
      knownOfficialUrls: [KNOWN_URL],
    });
    expect(result.mergedCount).toBe(0);
    expect(result.registry).toHaveLength(2);
  });

  it("origin一致だけでは統合しない(pathが違う)", async () => {
    mockResolve.mockResolvedValue({
      status: "resolved",
      url: "https://robata-jun.com/menu",
      finalStatus: 200,
    });
    const result = await resolveOfficialAliases({
      registry: [knownEntry(), candidateEntry()],
      knownOfficialUrls: [KNOWN_URL],
    });
    expect(result.mergedCount).toBe(0);
  });

  it("www.の有無だけの違いでは統合しない", async () => {
    mockResolve.mockResolvedValue({
      status: "resolved",
      url: "https://www.robata-jun.com/",
      finalStatus: 200,
    });
    const result = await resolveOfficialAliases({
      registry: [knownEntry(), candidateEntry()],
      knownOfficialUrls: [KNOWN_URL],
    });
    expect(result.mergedCount).toBe(0);
  });

  it("known_store_dataエントリが存在しなければ統合しない(統合先が無い)", async () => {
    mockResolve.mockResolvedValue({ status: "resolved", url: KNOWN_URL, finalStatus: 200 });
    const result = await resolveOfficialAliases({
      registry: [candidateEntry()],
      knownOfficialUrls: [KNOWN_URL],
    });
    expect(result.mergedCount).toBe(0);
    expect(result.registry).toHaveLength(1);
  });

  it("known_store_data由来のエントリ自体はresolve対象にしない", async () => {
    mockResolve.mockResolvedValue({ status: "resolved", url: KNOWN_URL, finalStatus: 200 });
    await resolveOfficialAliases({
      registry: [knownEntry()],
      knownOfficialUrls: [KNOWN_URL],
    });
    expect(mockResolve).not.toHaveBeenCalled();
  });
});

describe("resolveOfficialAliases — 表示・監査用の副産物", () => {
  it("統合されなかった候補にはresolved_url / resolve_statusを記録する", async () => {
    mockResolve.mockResolvedValue({
      status: "resolved",
      url: "https://tabelog.com/xyz/",
      finalStatus: 200,
    });
    const result = await resolveOfficialAliases({
      registry: [knownEntry(), candidateEntry()],
      knownOfficialUrls: [KNOWN_URL],
    });
    const candidate = result.registry.find((e) => e.discovery_provenance === "gemini_search_candidate");
    expect(candidate?.resolved_url).toBe("https://tabelog.com/xyz/");
    expect(candidate?.resolve_status).toBe("resolved");
  });

  it("resolver failureのエントリはresolve_status=failedになる", async () => {
    mockResolve.mockResolvedValue({ status: "failed", reason: "timeout" });
    const result = await resolveOfficialAliases({
      registry: [knownEntry(), candidateEntry()],
      knownOfficialUrls: [KNOWN_URL],
    });
    const candidate = result.registry.find((e) => e.discovery_provenance === "gemini_search_candidate");
    expect(candidate?.resolve_status).toBe("failed");
    expect(candidate?.resolved_url).toBeNull();
  });

  it("maxEntriesを超える候補はresolveしない(latency上限)", async () => {
    mockResolve.mockResolvedValue({ status: "failed", reason: "timeout" });
    const many = Array.from({ length: 12 }, (_, i) =>
      candidateEntry({ id: `S${i + 2}`, grounding_redirect_url: `${REDIRECT}${i}` }),
    );
    await resolveOfficialAliases({
      registry: [knownEntry(), ...many],
      knownOfficialUrls: [KNOWN_URL],
      maxEntries: 8,
    });
    expect(mockResolve).toHaveBeenCalledTimes(8);
  });
});

/**
 * alias 統合と SearchFact の関係(最終レビュー指摘3)。
 *
 * 統合すると candidate の `grounding_redirect_url` は registry から消えるため、
 * `workflows/store-research.ts` の `registryIdByUrl` lookup が miss し、
 * その source 由来の SearchFact は落ちる。**これは意図した挙動**である:
 *
 * - Tier B(`isTierBEligible`)は `discovery_provenance === "known_store_data"` のみ許可。
 *   統合**前**の candidate 由来 SearchFact はもともと Tier B 対象外で、
 *   confirmed 判定にも `pruneUnverifiedSourceIds` の表示にも寄与していない
 *   (`research-result-schema.test.ts` の「gemini_search_candidate は Tier B 不可」参照)。
 * - 逆に known_store_data 側の ID へ **rewrite すると**、Stage1 の検索スニペット由来の値が
 *   「known_store_data の SearchFact」に化けて **Tier B 適格になってしまう**。
 *   redirect 一致を根拠に trust boundary を緩める行為であり、採用できない。
 *
 * よって「rewrite しない = 捨てる」が正しい。本 describe はその構造を固定する。
 */
describe("alias統合とSearchFactの関係(最終レビュー指摘3)", () => {
  it("統合後のregistryにcandidateのredirect URLが残らない(SearchFactのlookupが構造的にmissする)", async () => {
    mockResolve.mockResolvedValue({ status: "resolved", url: KNOWN_URL, finalStatus: 200 });

    const result = await resolveOfficialAliases({
      registry: [knownEntry(), candidateEntry()],
      knownOfficialUrls: [KNOWN_URL],
    });

    const urls = result.registry.map((e) => e.grounding_redirect_url);
    expect(urls).not.toContain(REDIRECT);
    expect(urls).toEqual([KNOWN_URL]);
  });

  it("known_store_dataエントリのURL/provenance/source_typeをcandidate側の値で書き換えない", async () => {
    mockResolve.mockResolvedValue({ status: "resolved", url: KNOWN_URL, finalStatus: 200 });

    const result = await resolveOfficialAliases({
      registry: [knownEntry(), candidateEntry({ title: "【公式】と自称するtitle" })],
      knownOfficialUrls: [KNOWN_URL],
    });

    const merged = result.registry[0]!;
    expect(merged.discovery_provenance).toBe("known_store_data");
    expect(merged.source_type).toBe("official_site");
    expect(merged.grounding_redirect_url).toBe(KNOWN_URL);
    // モデル自己申告の title を統合先へ持ち込まない。
    expect(merged.title).toBe("公式サイト(登録情報)");
  });

  it("統合されなかった場合はcandidateのIDが残り、従来どおりSearchFactを解決できる", async () => {
    mockResolve.mockResolvedValue({ status: "failed", reason: "timeout" });

    const result = await resolveOfficialAliases({
      registry: [knownEntry(), candidateEntry()],
      knownOfficialUrls: [KNOWN_URL],
    });

    const urls = result.registry.map((e) => e.grounding_redirect_url);
    expect(urls).toContain(REDIRECT);
  });
});
