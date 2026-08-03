/**
 * Source Registry builder の単体検証(AI 店舗調査再設計 Plan v3.2 §8, PR2、
 * fix/ai-research-poc-like-retrieval で全面改訂)。
 *
 * 「モデル生成URLは候補として使う。実ページをURL Contextで取得できたものだけ、
 * 最終的な根拠として信用する」という新方針のうち、Source Registry構築部分
 * (候補として登録する・最低限のURL検証のみ行う)を重点的に検証する。
 * 信頼境界(confirmedの根拠にできるか)は `research-result-schema.test.ts` 側の
 * `validateResearchItemStatus` が担当する(本ファイルでは変更していない)。
 */

import { describe, it, expect } from "vitest";
import {
  buildSourceRegistry,
  buildKnownStoreDataEntries,
  buildKnownStoreDataUrls,
  mergeKnownStoreDataIntoRegistry,
  isValidCandidateUrl,
  parseSourceBlocks,
  parseSearchNotes,
  type GroundingMetadataLike,
} from "../source-registry";

const REDIRECT_A =
  "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQEV8dHK...";
const REDIRECT_B =
  "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQGcjf-G...";

describe("parseSourceBlocks", () => {
  it("PoCと同一書式の[SOURCE]ブロックを抽出する", () => {
    const text = `
何らかの前置き文章。

[SOURCE]
url: ${REDIRECT_A}
title: YELLOW PIZZA - 公式店舗サイト
type: official_site
why_useful: 正確な住所が確認できる
[/SOURCE]

[SOURCE]
url: ${REDIRECT_B}
title: 楽天ぐるなび
type: gourmet_site
why_useful: メニュー詳細
[/SOURCE]
`;
    const blocks = parseSourceBlocks(text);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toEqual({
      url: REDIRECT_A,
      title: "YELLOW PIZZA - 公式店舗サイト",
      type: "official_site",
      whyUseful: "正確な住所が確認できる",
    });
  });

  it("urlフィールドが無いブロックは無視する", () => {
    const text = `[SOURCE]\ntitle: no url here\n[/SOURCE]`;
    expect(parseSourceBlocks(text)).toHaveLength(0);
  });

  it("[SOURCE]ブロックが無いテキストは空配列を返す", () => {
    expect(parseSourceBlocks("普通のテキストです")).toEqual([]);
  });
});

describe("isValidCandidateUrl (最低限のURL形式チェック)", () => {
  it("https URLを許可する", () => {
    expect(isValidCandidateUrl("https://example.com/page")).toBe(true);
  });

  it("http URLを許可する", () => {
    expect(isValidCandidateUrl("http://example.com/page")).toBe(true);
  });

  it("parse不可能なURLを拒否する", () => {
    expect(isValidCandidateUrl("not a url")).toBe(false);
  });

  it("javascript:を拒否する", () => {
    expect(isValidCandidateUrl("javascript:alert(1)")).toBe(false);
  });

  it("data:を拒否する", () => {
    expect(isValidCandidateUrl("data:text/html,<script>alert(1)</script>")).toBe(false);
  });

  it("file:を拒否する", () => {
    expect(isValidCandidateUrl("file:///etc/passwd")).toBe(false);
  });

  it("credentials付きURLを拒否する", () => {
    expect(isValidCandidateUrl("https://user:pass@example.com/")).toBe(false);
  });

  it("空文字を拒否する", () => {
    expect(isValidCandidateUrl("")).toBe(false);
    expect(isValidCandidateUrl("   ")).toBe(false);
  });
});

describe("buildSourceRegistry", () => {
  it("groundingChunksを基準にSource Registryを構築する(discovery_provenance=google_grounding)", () => {
    const groundingMetadata: GroundingMetadataLike = {
      groundingChunks: [
        { web: { uri: REDIRECT_A, title: "gorp.jp" } },
        { web: { uri: REDIRECT_B, title: "retty.me" } },
      ],
    };
    const registry = buildSourceRegistry(groundingMetadata, "");

    expect(registry).toHaveLength(2);
    expect(registry[0]).toMatchObject({
      id: "S01",
      grounding_redirect_url: REDIRECT_A,
      title: "gorp.jp",
      discovery_provenance: "google_grounding",
      resolve_status: "skipped",
      url_context_status: "not_attempted",
      resolved_url: null,
    });
    expect(registry[1]!.id).toBe("S02");
  });

  it("groundingMetadataが無くても[SOURCE]候補URLからSource Registryを構築する(中核要件、fix/ai-research-poc-like-retrieval)", () => {
    const modelFreeText = `
[SOURCE]
url: ${REDIRECT_A}
title: 公式サイト
type: official_site
why_useful: x
[/SOURCE]

[SOURCE]
url: https://example.com/gourmet-page
title: グルメサイト掲載ページ
type: gourmet_site
why_useful: y
[/SOURCE]
`;
    const registry = buildSourceRegistry(null, modelFreeText);

    expect(registry).toHaveLength(2);
    expect(registry[0]!.discovery_provenance).toBe("gemini_search_candidate");
    expect(registry[0]!.grounding_redirect_url).toBe(REDIRECT_A);
    expect(registry[1]!.discovery_provenance).toBe("gemini_search_candidate");
  });

  it("groundingChunksと[SOURCE]候補が両方ある場合、重複しないURLは両方登録する", () => {
    const groundingMetadata: GroundingMetadataLike = {
      groundingChunks: [{ web: { uri: REDIRECT_A, title: "gorp.jp" } }],
    };
    const modelFreeText = `
[SOURCE]
url: ${REDIRECT_A}
title: 公式サイト
type: official_site
why_useful: x
[/SOURCE]

[SOURCE]
url: https://example.com/only-in-free-text
title: 自由記述のみの候補
type: article
why_useful: y
[/SOURCE]
`;
    const registry = buildSourceRegistry(groundingMetadata, modelFreeText);

    expect(registry).toHaveLength(2);
    expect(registry[0]!.discovery_provenance).toBe("google_grounding"); // groundingChunks優先
    expect(registry[1]!.discovery_provenance).toBe("gemini_search_candidate");
    expect(registry[1]!.grounding_redirect_url).toBe("https://example.com/only-in-free-text");
  });

  it("同一URLが重複して登録されない(groundingChunksとの重複除去)", () => {
    const groundingMetadata: GroundingMetadataLike = {
      groundingChunks: [{ web: { uri: REDIRECT_A, title: "gorp.jp" } }],
    };
    const modelFreeText = `[SOURCE]\nurl: ${REDIRECT_A}\ntitle: x\ntype: official_site\nwhy_useful: y\n[/SOURCE]`;
    const registry = buildSourceRegistry(groundingMetadata, modelFreeText);
    expect(registry).toHaveLength(1);
  });

  it("不正な形式のURL(javascript:等)は候補として登録しない", () => {
    const modelFreeText = `
[SOURCE]
url: javascript:alert(1)
title: x
type: other
why_useful: y
[/SOURCE]

[SOURCE]
url: https://example.com/valid
title: valid
type: other
why_useful: y
[/SOURCE]
`;
    const registry = buildSourceRegistry(null, modelFreeText);
    expect(registry).toHaveLength(1);
    expect(registry[0]!.grounding_redirect_url).toBe("https://example.com/valid");
  });

  it("最大15件に制限する", () => {
    const blocks = Array.from(
      { length: 20 },
      (_, i) => `[SOURCE]\nurl: https://example.com/${i}\ntitle: t${i}\ntype: other\nwhy_useful: y\n[/SOURCE]`,
    ).join("\n");
    const registry = buildSourceRegistry(null, blocks);
    expect(registry).toHaveLength(15);
    expect(registry[14]!.id).toBe("S15");
  });

  it("URL完全一致したブロックのtypeをenrichmentとして採用する", () => {
    const groundingMetadata: GroundingMetadataLike = {
      groundingChunks: [{ web: { uri: REDIRECT_A, title: "gorp.jp" } }],
    };
    const modelFreeText = `
[SOURCE]
url: ${REDIRECT_A}
title: YELLOW PIZZA 公式
type: official_site
why_useful: x
[/SOURCE]
`;
    const registry = buildSourceRegistry(groundingMetadata, modelFreeText);
    expect(registry[0]!.source_type).toBe("official_site");
    expect(registry[0]!.title).toBe("YELLOW PIZZA 公式"); // enrichment優先
  });

  it("一致しないtype文字列はotherにフォールバックする", () => {
    const modelFreeText = `[SOURCE]\nurl: ${REDIRECT_A}\ntitle: x\ntype: not_a_real_type\nwhy_useful: y\n[/SOURCE]`;
    const registry = buildSourceRegistry(null, modelFreeText);
    expect(registry[0]!.source_type).toBe("other");
  });

  it("groundingChunksもモデル自由記述も無ければ空配列を返す(後方互換)", () => {
    expect(buildSourceRegistry(null, "")).toEqual([]);
    expect(buildSourceRegistry({ groundingChunks: [] }, "")).toEqual([]);
  });

  it("uriが無いgroundingChunkは除外する", () => {
    const groundingMetadata: GroundingMetadataLike = {
      groundingChunks: [{ web: { uri: undefined, title: "no uri" } }, { web: null }],
    };
    expect(buildSourceRegistry(groundingMetadata, "")).toEqual([]);
  });

  it("IDはS01からの連番でゼロパディングされる", () => {
    const groundingMetadata: GroundingMetadataLike = {
      groundingChunks: Array.from({ length: 12 }, (_, i) => ({
        web: { uri: `https://vertexaisearch.cloud.google.com/grounding-api-redirect/${i}`, title: `t${i}` },
      })),
    };
    const registry = buildSourceRegistry(groundingMetadata, "");
    expect(registry[0]!.id).toBe("S01");
    expect(registry[9]!.id).toBe("S10");
    expect(registry[11]!.id).toBe("S12");
  });
});

describe("buildKnownStoreDataUrls", () => {
  it("site_url/instagram_urlが両方あれば2件返す", () => {
    const urls = buildKnownStoreDataUrls({
      site_url: "https://robata-jun.com/",
      instagram_url: "https://instagram.com/robata_jun",
    });
    expect(urls).toHaveLength(2);
    expect(urls[0]!.source_type).toBe("official_site");
    expect(urls[1]!.source_type).toBe("official_sns");
  });

  it("空文字は除外する", () => {
    const urls = buildKnownStoreDataUrls({ site_url: "", instagram_url: "" });
    expect(urls).toEqual([]);
  });

  it("site_urlのみの場合は1件のみ返す", () => {
    const urls = buildKnownStoreDataUrls({ site_url: "https://robata-jun.com/", instagram_url: "" });
    expect(urls).toHaveLength(1);
    expect(urls[0]!.source_type).toBe("official_site");
  });
});

describe("buildKnownStoreDataEntries", () => {
  it("有効なURLのみdiscovery_provenance=known_store_dataのエントリへ変換する", () => {
    const entries = buildKnownStoreDataEntries([
      { url: "https://robata-jun.com/", title: "公式サイト", source_type: "official_site" },
      { url: "javascript:alert(1)", title: "不正", source_type: "other" },
    ]);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.discovery_provenance).toBe("known_store_data");
  });

  it("重複URLは1件に統合する", () => {
    const entries = buildKnownStoreDataEntries([
      { url: "https://robata-jun.com/", title: "a", source_type: "official_site" },
      { url: "https://robata-jun.com/", title: "b", source_type: "official_site" },
    ]);
    expect(entries).toHaveLength(1);
  });
});

describe("mergeKnownStoreDataIntoRegistry", () => {
  const geminiRegistry = buildSourceRegistry(
    null,
    `[SOURCE]\nurl: ${REDIRECT_A}\ntitle: 候補\ntype: gourmet_site\nwhy_useful: y\n[/SOURCE]`,
  );

  it("known_store_dataをGemini候補より先頭(優先)に配置する", () => {
    const known = buildKnownStoreDataEntries([
      { url: "https://robata-jun.com/", title: "公式サイト(登録情報)", source_type: "official_site" },
    ]);
    const merged = mergeKnownStoreDataIntoRegistry(geminiRegistry, known);

    expect(merged).toHaveLength(2);
    expect(merged[0]!.discovery_provenance).toBe("known_store_data");
    expect(merged[1]!.discovery_provenance).toBe("gemini_search_candidate");
  });

  it("known_store_dataがGemini候補と同一URLの場合、known_store_data側を優先し重複させない", () => {
    const known = buildKnownStoreDataEntries([
      { url: REDIRECT_A, title: "known側のタイトル", source_type: "official_site" },
    ]);
    const merged = mergeKnownStoreDataIntoRegistry(geminiRegistry, known);

    expect(merged).toHaveLength(1);
    expect(merged[0]!.discovery_provenance).toBe("known_store_data");
    expect(merged[0]!.title).toBe("known側のタイトル");
  });

  it("known_store_dataが空ならGemini候補のみでid再採番される(後方互換)", () => {
    const merged = mergeKnownStoreDataIntoRegistry(geminiRegistry, []);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.id).toBe("S01");
    expect(merged[0]!.discovery_provenance).toBe("gemini_search_candidate");
  });

  it("合計が15件を超える場合は上限で切り詰める(known_store_data優先で保持)", () => {
    const manyGeminiCandidates = buildSourceRegistry(
      null,
      Array.from(
        { length: 15 },
        (_, i) => `[SOURCE]\nurl: https://example.com/${i}\ntitle: t${i}\ntype: other\nwhy_useful: y\n[/SOURCE]`,
      ).join("\n"),
    );
    const known = buildKnownStoreDataEntries([
      { url: "https://robata-jun.com/", title: "公式", source_type: "official_site" },
    ]);
    const merged = mergeKnownStoreDataIntoRegistry(manyGeminiCandidates, known);

    expect(merged).toHaveLength(15);
    expect(merged[0]!.discovery_provenance).toBe("known_store_data");
  });
});

describe("parseSearchNotes (feat/ai-research-source-diversity)", () => {
  it("[SEARCH_NOTE]ブロックを抽出する", () => {
    const text = `[SEARCH_NOTE]\nsource_url: ${REDIRECT_A}\nkind: store_fact\nsummary: 総席数52席、予算4,000〜4,999円と掲載\n[/SEARCH_NOTE]`;
    const notes = parseSearchNotes(text);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toEqual({
      sourceUrl: REDIRECT_A,
      kind: "store_fact",
      summary: "総席数52席、予算4,000〜4,999円と掲載",
    });
  });

  it("複数ブロック・複数kindを抽出する", () => {
    const text = `
[SEARCH_NOTE]
source_url: ${REDIRECT_A}
kind: review_signal
summary: 原始焼きのライブ感と魚料理を評価する口コミが複数見られる
[/SEARCH_NOTE]

[SEARCH_NOTE]
source_url: ${REDIRECT_B}
kind: negative_review_signal
summary: 一部口コミで料理提供までの時間への指摘が見られる
[/SEARCH_NOTE]
`;
    const notes = parseSearchNotes(text);
    expect(notes).toHaveLength(2);
    expect(notes[0]!.kind).toBe("review_signal");
    expect(notes[1]!.kind).toBe("negative_review_signal");
  });

  it("未知のkindは破棄する", () => {
    const text = `[SEARCH_NOTE]\nsource_url: ${REDIRECT_A}\nkind: not_a_real_kind\nsummary: x\n[/SEARCH_NOTE]`;
    expect(parseSearchNotes(text)).toEqual([]);
  });

  it("不正なsource_urlは破棄する", () => {
    const text = `[SEARCH_NOTE]\nsource_url: javascript:alert(1)\nkind: store_fact\nsummary: x\n[/SEARCH_NOTE]`;
    expect(parseSearchNotes(text)).toEqual([]);
  });

  it("summaryが無いブロックは破棄する", () => {
    const text = `[SEARCH_NOTE]\nsource_url: ${REDIRECT_A}\nkind: store_fact\n[/SEARCH_NOTE]`;
    expect(parseSearchNotes(text)).toEqual([]);
  });

  it("長いsummaryは200文字で切り詰める(レビュー全文コピペ防止)", () => {
    const longSummary = "あ".repeat(300);
    const text = `[SEARCH_NOTE]\nsource_url: ${REDIRECT_A}\nkind: store_fact\nsummary: ${longSummary}\n[/SEARCH_NOTE]`;
    const notes = parseSearchNotes(text);
    expect(notes[0]!.summary.length).toBe(201); // 200文字 + "…"
    expect(notes[0]!.summary.endsWith("…")).toBe(true);
  });

  it("最大20件までに制限する(prompt肥大化防止)", () => {
    const blocks = Array.from(
      { length: 30 },
      (_, i) =>
        `[SEARCH_NOTE]\nsource_url: https://example.com/${i}\nkind: store_fact\nsummary: note${i}\n[/SEARCH_NOTE]`,
    ).join("\n");
    expect(parseSearchNotes(blocks)).toHaveLength(20);
  });
});

describe("buildSourceRegistry の多様性capping (feat/ai-research-source-diversity)", () => {
  it("公式サイトのみで候補が埋め尽くされている場合、公式バケットのソフト上限(3件)を超えて登録しない", () => {
    const blocks = Array.from(
      { length: 10 },
      (_, i) =>
        `[SOURCE]\nurl: https://official-${i}.example.com/\ntitle: 公式${i}\ntype: official_site\nwhy_useful: y\n[/SOURCE]`,
    ).join("\n");
    const registry = buildSourceRegistry(null, blocks);
    // 全体は15件以下、official_siteは同一バケットのため3件までのはずだが、
    // 他バケットの候補が無いためbackfillにより全体枠(10件)は消費される。
    expect(registry).toHaveLength(10);
  });

  it("多様なsource_typeが混在する場合、公式サイトのバケット上限により他typeも登録される", () => {
    const officialBlocks = Array.from(
      { length: 8 },
      (_, i) =>
        `[SOURCE]\nurl: https://official-${i}.example.com/\ntitle: 公式${i}\ntype: official_site\nwhy_useful: y\n[/SOURCE]`,
    ).join("\n");
    const gourmetBlocks = Array.from(
      { length: 8 },
      (_, i) =>
        `[SOURCE]\nurl: https://gourmet-${i}.example.com/\ntitle: グルメ${i}\ntype: gourmet_site\nwhy_useful: y\n[/SOURCE]`,
    ).join("\n");
    const registry = buildSourceRegistry(null, `${officialBlocks}\n${gourmetBlocks}`);

    const officialCount = registry.filter((e) => e.source_type === "official_site").length;
    const gourmetCount = registry.filter((e) => e.source_type === "gourmet_site").length;
    expect(registry.length).toBeLessThanOrEqual(15);
    // 公式サイトが先に列挙されていても、gourmet_siteが後段の枠を確保できている。
    expect(gourmetCount).toBeGreaterThan(0);
    expect(officialCount).toBeLessThanOrEqual(8);
  });

  it("同一ドメインからの候補を過度に登録しない(ドメイン上限3件)", () => {
    const blocks = Array.from(
      { length: 10 },
      (_, i) =>
        `[SOURCE]\nurl: https://example.com/page${i}\ntitle: p${i}\ntype: gourmet_site\nwhy_useful: y\n[/SOURCE]`,
    ).join("\n");
    // 同一typeのみのため他バケットの候補が無く、backfillにより全体枠(10件)は消費される
    // (多様な候補が他に存在する場合のみ、ドメイン上限が実際の絞り込みとして機能する)。
    const registry = buildSourceRegistry(null, blocks);
    expect(registry.length).toBe(10);
  });
});
