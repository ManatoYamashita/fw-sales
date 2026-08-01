/**
 * Source Registry builder の単体検証(AI 店舗調査再設計 Plan v3.2 §8, PR2)。
 *
 * 「モデルが自由生成したURLはSource Registryへ自動登録しない」という
 * 中核要件を重点的に検証する。
 */

import { describe, it, expect } from "vitest";
import {
  buildSourceRegistry,
  parseSourceBlocks,
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

describe("buildSourceRegistry", () => {
  it("groundingChunksを基準にSource Registryを構築する", () => {
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

  it("groundingChunksに無いモデル自由生成URLは登録しない (中核要件)", () => {
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
url: https://this-was-never-in-grounding-chunks.example.com/fabricated
title: モデルが捏造したサイト
type: article
why_useful: y
[/SOURCE]
`;
    const registry = buildSourceRegistry(groundingMetadata, modelFreeText);

    expect(registry).toHaveLength(1); // 捏造URLは登録されない
    expect(registry[0]!.grounding_redirect_url).toBe(REDIRECT_A);
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
    const groundingMetadata: GroundingMetadataLike = {
      groundingChunks: [{ web: { uri: REDIRECT_A, title: "gorp.jp" } }],
    };
    const modelFreeText = `
[SOURCE]
url: ${REDIRECT_A}
title: x
type: not_a_real_type
why_useful: y
[/SOURCE]
`;
    const registry = buildSourceRegistry(groundingMetadata, modelFreeText);
    expect(registry[0]!.source_type).toBe("other");
  });

  it("enrichmentが無い場合もtitleはgroundingChunksのtitleにフォールバックする", () => {
    const groundingMetadata: GroundingMetadataLike = {
      groundingChunks: [{ web: { uri: REDIRECT_A, title: "gorp.jp" } }],
    };
    const registry = buildSourceRegistry(groundingMetadata, "");
    expect(registry[0]!.title).toBe("gorp.jp");
    expect(registry[0]!.source_type).toBe("other");
  });

  it("groundingChunksが空/未定義なら空配列を返す", () => {
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
