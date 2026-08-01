/**
 * プロンプト構築の単体検証(AI 店舗調査再設計 Plan v3.2 §8, PR2)。
 */

import { describe, it, expect } from "vitest";
import {
  buildStage1Prompt,
  buildStage2Prompt,
  selectItemsForTrack,
} from "../prompts";
import { RESEARCH_POLICY_ITEMS } from "@/lib/domain/research-policy";
import type { SourceRegistryEntry } from "@/lib/ai/research-result-schema";

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
});

describe("selectItemsForTrack", () => {
  it("FACTトラックはFACTとFACT_OR_HEARINGを含む", () => {
    const items = selectItemsForTrack(RESEARCH_POLICY_ITEMS, "FACT");
    const keys = new Set(items.map((i) => i.key));
    expect(keys.has("business_hours_holidays")).toBe(true); // FACT
    expect(keys.has("owner_profile")).toBe(true); // FACT_OR_HEARING
    expect(keys.has("market_demand")).toBe(false); // ANALYSIS
    expect(keys.has("revenue")).toBe(false); // HEARING_ONLY
  });

  it("ANALYSISトラックはANALYSISのみを含む", () => {
    const items = selectItemsForTrack(RESEARCH_POLICY_ITEMS, "ANALYSIS");
    const keys = new Set(items.map((i) => i.key));
    expect(keys.has("market_demand")).toBe(true);
    expect(keys.has("business_hours_holidays")).toBe(false);
  });

  it("FACT+ANALYSISの合計はHEARING_ONLY/EXTERNAL_DATA_REQUIREDを除いた件数と一致する", () => {
    const fact = selectItemsForTrack(RESEARCH_POLICY_ITEMS, "FACT");
    const analysis = selectItemsForTrack(RESEARCH_POLICY_ITEMS, "ANALYSIS");
    const aiCallCount = RESEARCH_POLICY_ITEMS.filter(
      (i) => i.research_policy !== "HEARING_ONLY" && i.research_policy !== "EXTERNAL_DATA_REQUIRED",
    ).length;
    expect(fact.length + analysis.length).toBe(aiCallCount);
  });

  it("各項目にlabelが解決される", () => {
    const items = selectItemsForTrack(RESEARCH_POLICY_ITEMS, "FACT");
    const businessHours = items.find((i) => i.key === "business_hours_holidays");
    expect(businessHours?.label).toBe("営業時間・定休日");
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

  it("FACTトラックのプロンプトにconfirmed/conflict/not_foundの指示を含む", () => {
    const prompt = buildStage2Prompt({
      store: STORE,
      track: "FACT",
      items: [{ key: "business_hours_holidays", label: "営業時間・定休日" }],
      sourceRegistry: registry,
    });
    expect(prompt).toContain("inferred");
    expect(prompt).toContain("S01");
    expect(prompt).toContain("URLそのものを");
  });

  it("prompt injection対策の指示を含む", () => {
    const prompt = buildStage2Prompt({
      store: STORE,
      track: "FACT",
      items: [{ key: "business_hours_holidays", label: "営業時間・定休日" }],
      sourceRegistry: registry,
    });
    expect(prompt).toContain("信頼できない外部データ");
    expect(prompt).toContain("従わないでください");
  });

  it("ANALYSISトラックのプロンプトに過去の誤判定回避指示を含む", () => {
    const prompt = buildStage2Prompt({
      store: STORE,
      track: "ANALYSIS",
      items: [{ key: "market_demand", label: "市場需要" }],
      sourceRegistry: registry,
    });
    expect(prompt).toContain("有料広告");
    expect(prompt).toContain("市場需要");
    expect(prompt).toContain("非常に高い");
  });

  it("Source Registryが空の場合の案内文を含む", () => {
    const prompt = buildStage2Prompt({
      store: STORE,
      track: "FACT",
      items: [{ key: "business_hours_holidays", label: "営業時間・定休日" }],
      sourceRegistry: [],
    });
    expect(prompt).toContain("情報源が発見されませんでした");
  });

  it("Google Searchを使わない旨を明記する", () => {
    const prompt = buildStage2Prompt({
      store: STORE,
      track: "FACT",
      items: [{ key: "business_hours_holidays", label: "営業時間・定休日" }],
      sourceRegistry: registry,
    });
    expect(prompt).toContain("Web検索は使用しないこと");
  });
});
