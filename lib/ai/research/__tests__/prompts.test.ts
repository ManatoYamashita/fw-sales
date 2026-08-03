/**
 * プロンプト構築の単体検証(AI 店舗調査再設計 Plan v3.2 §8, PR2、
 * fix/ai-research-poc-like-retrieval で Stage2 統合に合わせ更新)。
 */

import { describe, it, expect } from "vitest";
import {
  buildStage1Prompt,
  buildStage2Prompt,
  selectAiResearchItems,
} from "../prompts";
import { RESEARCH_POLICY_ITEMS } from "@/lib/domain/research-policy";
import type { SourceRegistryEntry } from "@/lib/ai/research-result-schema";
import type { SearchNote } from "@/lib/ai/research/source-registry";

const STORE = { name: "YELLOW PIZZA", address: "神奈川県横浜市港北区菊名1-7-2", phone: "045-642-7213", genre: "イタリアン" };

describe("buildStage1Prompt", () => {
  it("店舗情報と同定ルール、出力形式を含む", () => {
    const prompt = buildStage1Prompt(STORE);
    expect(prompt).toContain(STORE.name);
    expect(prompt).toContain(STORE.address);
    expect(prompt).toContain(STORE.phone);
    expect(prompt).toContain("[QUERY]");
    expect(prompt).toContain("[SOURCE]");
  });

  it("prompt injection対策の指示を含む", () => {
    const prompt = buildStage1Prompt(STORE);
    expect(prompt).toContain("信頼できない外部データ");
    expect(prompt).toContain("53項目の調査結果そのものは");
  });

  it("目的別に多様な検索クエリ例を含む(feat/ai-research-source-diversity)", () => {
    const prompt = buildStage1Prompt(STORE);
    expect(prompt).toContain("店舗名 + 食べログ");
    expect(prompt).toContain("店舗名 + 口コミ");
    expect(prompt).toContain("店舗名 + 評判");
  });

  it("公式サイトのみで探索を打ち切らない旨の指示を含む", () => {
    const prompt = buildStage1Prompt(STORE);
    expect(prompt).toContain("公式サイトが見つかったからといって探索を打ち切らないでください");
  });

  it("[SEARCH_NOTE]の出力形式を含む", () => {
    const prompt = buildStage1Prompt(STORE);
    expect(prompt).toContain("[SEARCH_NOTE]");
    expect(prompt).toContain("source_url");
    expect(prompt).toContain("store_fact");
    expect(prompt).toContain("review_signal");
    expect(prompt).toContain("negative_review_signal");
    expect(prompt).toContain("usage_signal");
  });
});

describe("selectAiResearchItems", () => {
  it("FACT / FACT_OR_HEARING / ANALYSISを含み、HEARING_ONLY / EXTERNAL_DATA_REQUIREDを含まない", () => {
    const items = selectAiResearchItems(RESEARCH_POLICY_ITEMS);
    const keys = new Set(items.map((i) => i.key));
    expect(keys.has("business_hours_holidays")).toBe(true); // FACT
    expect(keys.has("owner_profile")).toBe(true); // FACT_OR_HEARING
    expect(keys.has("market_demand")).toBe(true); // ANALYSIS
    expect(keys.has("revenue")).toBe(false); // HEARING_ONLY
    expect(keys.has("search_volume")).toBe(false); // EXTERNAL_DATA_REQUIRED
  });

  it("件数はHEARING_ONLY/EXTERNAL_DATA_REQUIREDを除いた件数と一致する(単一call統合、fix/ai-research-poc-like-retrieval)", () => {
    const items = selectAiResearchItems(RESEARCH_POLICY_ITEMS);
    const expectedCount = RESEARCH_POLICY_ITEMS.filter(
      (i) => i.research_policy !== "HEARING_ONLY" && i.research_policy !== "EXTERNAL_DATA_REQUIRED",
    ).length;
    expect(items.length).toBe(expectedCount);
  });

  it("各項目にlabelとresearch_policyが解決される", () => {
    const items = selectAiResearchItems(RESEARCH_POLICY_ITEMS);
    const businessHours = items.find((i) => i.key === "business_hours_holidays");
    expect(businessHours?.label).toBe("営業時間・定休日");
    expect(businessHours?.research_policy).toBe("FACT");
  });
});

describe("buildStage2Prompt", () => {
  const registry: SourceRegistryEntry[] = [
    {
      id: "S01",
      title: "gnavi.co.jp",
      grounding_redirect_url: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/x",
      resolved_url: null,
      resolve_status: "skipped",
      source_type: "official_site",
      discovery_provenance: "google_grounding",
      url_context_status: "not_attempted",
    },
  ];

  const combinedItems = [
    { key: "business_hours_holidays", label: "営業時間・定休日", research_policy: "FACT" },
    { key: "market_demand", label: "市場需要", research_policy: "ANALYSIS" },
  ];

  it("FACT/ANALYSIS両方の判定基準を1つのプロンプトに含む(Stage2統合)", () => {
    const prompt = buildStage2Prompt({ store: STORE, items: combinedItems, sourceRegistry: registry });
    expect(prompt).toContain("inferred");
    expect(prompt).toContain("S01");
    expect(prompt).toContain("URLそのものを");
    expect(prompt).toContain("有料広告");
    expect(prompt).toContain("非常に高い");
  });

  it("prompt injection対策の指示を含む", () => {
    const prompt = buildStage2Prompt({ store: STORE, items: combinedItems, sourceRegistry: registry });
    expect(prompt).toContain("信頼できない外部データ");
    expect(prompt).toContain("従わないでください");
  });

  it("Source Registryが空の場合の案内文を含む", () => {
    const prompt = buildStage2Prompt({ store: STORE, items: combinedItems, sourceRegistry: [] });
    expect(prompt).toContain("情報源が発見されませんでした");
  });

  it("Google Searchを使わない旨を明記する", () => {
    const prompt = buildStage2Prompt({ store: STORE, items: combinedItems, sourceRegistry: registry });
    expect(prompt).toContain("Web検索は使用しないこと");
  });

  it("項目一覧をFACT/FACT_OR_HEARINGとANALYSISでグループ化する", () => {
    const prompt = buildStage2Prompt({ store: STORE, items: combinedItems, sourceRegistry: registry });
    expect(prompt).toContain("FACT / FACT_OR_HEARING項目");
    expect(prompt).toContain("ANALYSIS項目");
  });

  it("known_store_data等の候補URLが含まれうる旨の注記を含む", () => {
    const prompt = buildStage2Prompt({ store: STORE, items: combinedItems, sourceRegistry: registry });
    expect(prompt).toContain("候補");
  });

  it("evidenceを簡潔にする指示を含む(MAX_TOKENS対策、fix/ai-research-stage2-max-tokens)が、判定基準を弱める文言は含まない", () => {
    const prompt = buildStage2Prompt({ store: STORE, items: combinedItems, sourceRegistry: registry });
    expect(prompt).toContain("1〜2文");
    expect(prompt).not.toContain("判定を緩め");
  });

  describe("複数情報源の活用・Search Notes・口コミ活用(feat/ai-research-source-diversity)", () => {
    it("公式サイトのみに偏らないよう指示する", () => {
      const prompt = buildStage2Prompt({ store: STORE, items: combinedItems, sourceRegistry: registry });
      expect(prompt).toContain("公式サイトの情報だけで全項目を済ませないでください");
    });

    it("Source Registryに一致するsearchNotesはSearch Notesセクションへ含める", () => {
      const searchNotes: SearchNote[] = [
        {
          sourceUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/x",
          kind: "review_signal",
          summary: "原始焼きのライブ感を評価する口コミが複数見られる",
        },
      ];
      const prompt = buildStage2Prompt({
        store: STORE,
        items: combinedItems,
        sourceRegistry: registry,
        searchNotes,
      });
      expect(prompt).toContain("Search Notes");
      expect(prompt).toContain("原始焼きのライブ感を評価する口コミが複数見られる");
      expect(prompt).toContain("S01");
    });

    it("Source Registryに存在しないURLのsearchNotesは含めない(引用不能なため)", () => {
      const searchNotes: SearchNote[] = [
        {
          sourceUrl: "https://example.com/not-in-registry",
          kind: "store_fact",
          summary: "登録されていない情報源由来のnote",
        },
      ];
      const prompt = buildStage2Prompt({
        store: STORE,
        items: combinedItems,
        sourceRegistry: registry,
        searchNotes,
      });
      expect(prompt).not.toContain("登録されていない情報源由来のnote");
    });

    it("searchNotesが空/未指定でもエラーにならない", () => {
      expect(() =>
        buildStage2Prompt({ store: STORE, items: combinedItems, sourceRegistry: registry }),
      ).not.toThrow();
    });

    it("口コミ関連項目が含まれる場合は口コミ活用ガイダンスを含む", () => {
      const itemsWithReview = [
        ...combinedItems,
        { key: "review_tendency", label: "口コミ傾向", research_policy: "ANALYSIS" },
        { key: "negative_reviews", label: "ネガティブ口コミ", research_policy: "FACT" },
      ];
      const prompt = buildStage2Prompt({
        store: STORE,
        items: itemsWithReview,
        sourceRegistry: registry,
      });
      expect(prompt).toContain("口コミ・レビューの活用方法");
      expect(prompt).toContain("一部で〜という声");
      expect(prompt).toContain("複数の口コミで〜への言及");
    });

    it("口コミ関連項目が無い場合は口コミ活用ガイダンスを含まない", () => {
      const itemsWithoutReview = [
        { key: "business_hours_holidays", label: "営業時間・定休日", research_policy: "FACT" },
      ];
      const prompt = buildStage2Prompt({
        store: STORE,
        items: itemsWithoutReview,
        sourceRegistry: registry,
      });
      expect(prompt).not.toContain("口コミ・レビューの活用方法");
    });
  });
});
