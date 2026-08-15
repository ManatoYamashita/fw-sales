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

  it("最低限の探索カテゴリ(coverage floor)を含む(feat/ai-research-final-quality)", () => {
    const prompt = buildStage1Prompt(STORE);
    expect(prompt).toContain("最低限、以下のカテゴリすべてについて一度は検索を試みてください");
    expect(prompt).toContain("オープン日・沿革");
    expect(prompt).toContain("口コミ・評判(ネガティブな言及含む)");
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

  it("kind=store_factにはkey/valueが必須である旨と具体例を含む(feat/ai-research-searchfact-places-match、prompt/schema不整合の修正)", () => {
    const prompt = buildStage1Prompt(STORE);
    expect(prompt).toContain("kindが store_fact の場合");
    expect(prompt).toContain("key: (対象項目のkey");
    expect(prompt).toContain("value: (確認できた具体的な値");
    expect(prompt).toContain("seat_count");
    expect(prompt).toContain("nearest_station");
  });

  it("review_signal/negative_review_signal/usage_signalはkey/value不要と明記する", () => {
    const prompt = buildStage1Prompt(STORE);
    expect(prompt).toContain("review_signal / negative_review_signal / usage_signal の場合、key/valueは不要です");
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
    // feat/ai-research-quality-ux-hardening: 「1〜2文」は上限として弱かったため
    // 「1文・全角60字以内」へ**定量化**した(Plan §10.3-3)。指示を緩めたのではなく
    // 厳しくした変更であり、テストもその新しい仕様を固定する。
    expect(prompt).toContain("1文・全角60字以内");
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

    it("kind=store_factでkey/valueが構造化済みならSearch Notes表示にも明示する(feat/ai-research-pre-smoke-hardening、MAJOR7)", () => {
      const searchNotes: SearchNote[] = [
        {
          sourceUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/x",
          kind: "store_fact",
          summary: "席数は49席",
          key: "seat_count",
          value: "49席",
        },
      ];
      const prompt = buildStage2Prompt({
        store: STORE,
        items: combinedItems,
        sourceRegistry: registry,
        searchNotes,
      });
      expect(prompt).toContain("seat_count = 49席");
    });

    it("本文取得未確認でもSearch Notesを根拠に使った場合はsource_idを含めてよい旨を明示する(MAJOR7、prompt/runtime矛盾の解消)", () => {
      const prompt = buildStage2Prompt({ store: STORE, items: combinedItems, sourceRegistry: registry });
      expect(prompt).toContain("Search Notesとして明示的に提供された情報を、そのitemの根拠として使った場合");
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

  describe("項目別prompt較正(feat/ai-research-quality-refinement)", () => {
    it("phoneが含まれる場合は電話番号roleの指示を含む", () => {
      const items = [{ key: "phone", label: "電話番号", research_policy: "FACT" }];
      const prompt = buildStage2Prompt({ store: STORE, items, sourceRegistry: registry });
      expect(prompt).toContain("電話番号(phone)の判定に関する注意");
      expect(prompt).toContain("店舗直通番号");
    });

    it("phoneが含まれない場合は電話番号roleの指示を含まない", () => {
      const items = [{ key: "business_hours_holidays", label: "営業時間・定休日", research_policy: "FACT" }];
      const prompt = buildStage2Prompt({ store: STORE, items, sourceRegistry: registry });
      expect(prompt).not.toContain("電話番号(phone)の判定に関する注意");
    });

    it("average_spend_day_nightが含まれる場合は明示価格優先の指示を含む", () => {
      const items = [{ key: "average_spend_day_night", label: "客単価", research_policy: "ANALYSIS" }];
      const prompt = buildStage2Prompt({ store: STORE, items, sourceRegistry: registry });
      expect(prompt).toContain("まずグルメサイト・予約サイトに明示された予算帯を探してください");
    });

    it("opening_dateが含まれる場合は逆算推測禁止の指示を含む", () => {
      const items = [{ key: "opening_date", label: "オープン日", research_policy: "FACT" }];
      const prompt = buildStage2Prompt({ store: STORE, items, sourceRegistry: registry });
      expect(prompt).toContain("口コミの投稿日の古さ等から開店時期を逆算して推測することは禁止");
    });

    it("nearest_stationが含まれる場合はcomposite fieldの部分表現指示を含む", () => {
      const items = [{ key: "nearest_station", label: "最寄り駅", research_policy: "FACT" }];
      const prompt = buildStage2Prompt({ store: STORE, items, sourceRegistry: registry });
      expect(prompt).toContain("複数の情報を含む項目の書き方");
      expect(prompt).toContain("未確認");
    });

    it("Observed Web Presenceブロックは含まない(feat/ai-research-final-quality、Stage2実行前は常に空になる時系列バグのため撤去)", () => {
      const registryWithSuccess = [
        { ...registry[0]!, url_context_status: "success" as const, source_type: "gourmet_site" as const },
      ];
      const items = [{ key: "own_net_exposure", label: "自店のネット露出状況", research_policy: "ANALYSIS" }];
      const prompt = buildStage2Prompt({ store: STORE, items, sourceRegistry: registryWithSuccess });
      expect(prompt).not.toContain("実際に確認できたWeb露出");
    });

    it("media_coverageが含まれる場合、TV/雑誌に限定しない旨の指示を含む", () => {
      const items = [{ key: "media_coverage", label: "確認できた掲載媒体・メディア露出", research_policy: "FACT" }];
      const prompt = buildStage2Prompt({ store: STORE, items, sourceRegistry: registry });
      expect(prompt).toContain("「メディア」をTV・雑誌等の伝統的な媒体に限定しないでください");
    });

    it("sns_update_frequencyが含まれる場合、公式サイト自体の更新と混同しない旨の指示を含む", () => {
      const items = [{ key: "sns_update_frequency", label: "SNS更新頻度", research_policy: "FACT" }];
      const prompt = buildStage2Prompt({ store: STORE, items, sourceRegistry: registry });
      expect(prompt).toContain("公式サイト自体の更新頻度をSNS更新頻度の根拠にしないでください");
    });

    it("市場需要の強度表現の較正指示を含む", () => {
      const items = [{ key: "market_demand", label: "市場需要", research_policy: "ANALYSIS" }];
      const prompt = buildStage2Prompt({ store: STORE, items, sourceRegistry: registry });
      expect(prompt).toContain("一定の需要が示唆される");
    });

    it("competitor_paid_adsについて、ポータルページ・ネット予約の存在だけでは根拠にならない旨を明記する(feat/ai-research-final-quality)", () => {
      const items = [{ key: "competitor_paid_ads", label: "ライバル有料広告活用有無", research_policy: "ANALYSIS" }];
      const prompt = buildStage2Prompt({ store: STORE, items, sourceRegistry: registry });
      expect(prompt).toContain("単に店舗ページやネット予約枠が存在するだけ");
      expect(prompt).toContain("一切なりません");
    });

    it("own_net_exposure/exposure_gapが含まれる場合、absence-of-evidence guardの指示を含む(feat/ai-research-final-trust-boundary)", () => {
      const items = [{ key: "own_net_exposure", label: "自店のネット露出状況", research_policy: "ANALYSIS" }];
      const prompt = buildStage2Prompt({ store: STORE, items, sourceRegistry: registry });
      expect(prompt).toContain("「確認できない」ことの扱いに関する注意");
      expect(prompt).toContain("それ自体が「不足している」「弱い」「伸びしろがある」という証拠には");
    });

    it("own_net_exposure/exposure_gapが含まれない場合はabsence-of-evidence guardを含まない", () => {
      const items = [{ key: "business_hours_holidays", label: "営業時間・定休日", research_policy: "FACT" }];
      const prompt = buildStage2Prompt({ store: STORE, items, sourceRegistry: registry });
      expect(prompt).not.toContain("「確認できない」ことの扱いに関する注意");
    });
  });
});

/**
 * 出力量・優先取得ヒント(feat/ai-research-quality-ux-hardening、Plan §8.2 A / §10.3-3)。
 */
describe("buildStage2Prompt — 優先取得ヒントと出力簡潔化", () => {
  const REG = [
    {
      id: "S01",
      title: "公式サイト(登録情報)",
      grounding_redirect_url: "https://robata-jun.com/",
      resolved_url: null,
      resolve_status: "skipped" as const,
      source_type: "official_site" as const,
      discovery_provenance: "known_store_data" as const,
      url_context_status: "not_attempted" as const,
    },
    {
      id: "S02",
      title: "食べログ",
      grounding_redirect_url: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/x",
      resolved_url: null,
      resolve_status: "skipped" as const,
      source_type: "gourmet_site" as const,
      discovery_provenance: "gemini_search_candidate" as const,
      url_context_status: "not_attempted" as const,
    },
  ];
  const ITEMS = [
    { key: "concept", label: "コンセプト", research_policy: "FACT_OR_HEARING" as const },
  ];

  it("known_store_data のURLにだけ優先取得ヒントを付す", () => {
    const prompt = buildStage2Prompt({ store: STORE, items: ITEMS, sourceRegistry: REG });
    const s01Line = prompt.split("\n").find((l) => l.startsWith("- S01:"));
    const s02Line = prompt.split("\n").find((l) => l.startsWith("- S02:"));
    expect(s01Line).toContain("登録済み公式URL / 優先的に取得すること");
    expect(s02Line).not.toContain("優先的に取得すること");
  });

  it("公式サイトだけで済ませない指示は残す(情報源の分散を維持)", () => {
    const prompt = buildStage2Prompt({ store: STORE, items: ITEMS, sourceRegistry: REG });
    expect(prompt).toContain("公式サイトの情報だけで全項目を済ませないでください");
  });

  it("evidenceの長さ制限を定量化する(1文・全角60字以内)", () => {
    const prompt = buildStage2Prompt({ store: STORE, items: ITEMS, sourceRegistry: REG });
    expect(prompt).toContain("1文・全角60字以内");
  });

  it("判定基準や情報量を削ってはいけない旨の指示を必ず残す", () => {
    const prompt = buildStage2Prompt({ store: STORE, items: ITEMS, sourceRegistry: REG });
    expect(prompt).toContain("情報量そのものを");
    expect(prompt).toContain("削ることは絶対にしないでください");
  });

  it("source_verifications の relation / observed_* / identity検証の要求は削らない", () => {
    const prompt = buildStage2Prompt({ store: STORE, items: ITEMS, sourceRegistry: REG });
    expect(prompt).toContain("source_verifications");
    expect(prompt).toContain("observed_title / observed_name / observed_address / observed_phone");
    expect(prompt).toContain('"target_store"');
    expect(prompt).toContain("コピーしてはいけません");
  });
});

/**
 * phone の複数番号併記指示(PR #180 final smoke hardening、Issue B)。
 *
 * root cause は「canonical値を1つ選び、他の番号はevidence内へ補足」という
 * **single value を明示要求する指示**だった。役割ラベル付き併記へ変更する。
 */
describe("buildStage2Prompt — phone の複数番号併記 (Issue B)", () => {
  const PHONE_ITEMS = [{ key: "phone", label: "電話番号", research_policy: "FACT" }];
  const REG = [
    {
      id: "S01",
      title: "食べログ",
      grounding_redirect_url: "https://tabelog.com/x/",
      resolved_url: null,
      resolve_status: "skipped" as const,
      source_type: "gourmet_site" as const,
      discovery_provenance: "gemini_search_candidate" as const,
      url_context_status: "not_attempted" as const,
    },
  ];
  const prompt = () => buildStage2Prompt({ store: STORE, items: PHONE_ITEMS, sourceRegistry: REG });

  it("「canonical値を1つ選び」という single value 要求を含まない(root cause)", () => {
    expect(prompt()).not.toContain("canonical値を1つ選び");
  });

  it("役割ラベル付きで全て併記するよう指示する", () => {
    const p = prompt();
    expect(p).toContain("役割ラベル付きで全て併記");
    expect(p).toContain("店舗直通: 045-305-6536 / 予約・問い合わせ(食べログ): 050-5869-4190");
  });

  it("050を店舗直通と書かないよう明示する(意味を取り違えさせない)", () => {
    expect(prompt()).toContain("050番号を「店舗直通」と書いてはいけません");
  });

  it("valueに書いた番号をevidenceにも書くよう要求する(deterministic検証と対)", () => {
    expect(prompt()).toContain("valueに書いた電話番号は、必ずevidenceにも同じ番号を書いて");
  });

  it("用途不明な番号でconflictにしない既存方針は維持する", () => {
    expect(prompt()).toContain('矛盾する場合のみ"conflict"');
  });

  it("conflict時は各candidateのvalueの番号をそのcandidateのevidenceにも書くよう要求する(BLOCKER 2)", () => {
    const p = prompt();
    expect(p).toContain("各candidateのvalueに書いた電話番号");
    expect(p).toContain("そのcandidateのevidenceにも同じ番号");
  });

  it("用途が異なる2番号をconflict化しない方針を明示する(050 + 045 semantics)", () => {
    expect(prompt()).toContain("用途が異なる番号は捨てずに");
  });
});

/**
 * 電話番号を持つ店舗ページの意図的な探索(PR #180 final smoke hardening、Issue B-A)。
 *
 * ## 背景(実機: 関内 なむら / run research_run_mspjq6q1_1n1q4e)
 *
 * 食べログ店舗ページには「予約・お問い合わせ 050-5869-4190」と
 * 「電話番号 045-305-6536」の2番号があるが、**この run の Source Registry に
 * 食べログのエントリ自体が存在しなかった**(Safari Online / Casa BRUTUS /
 * 実食レポ記事 / Retty / competitor のみ)。
 *
 * 旧 prompt は「店舗名 + 食べログ」を**任意の例**として挙げるだけで、
 * 「電話番号(特に予約・問い合わせ番号)を掲載するページを探す」という
 * **目的ベースの指示が存在しなかった**。
 *
 * ## 設計方針(固定する不変条件)
 *
 * - 特定サイト(食べログ)の強制ではなく、**電話番号・予約導線を持つ店舗ページ**を
 *   目的として探させる。食べログが無い店舗でも他 source で正常継続する
 * - 店舗名・番号のハードコードをしない
 * - Stage1 の Gemini 呼び出し回数は増やさない(同一 prompt 内の指示のみ)
 */
describe("buildStage1Prompt — 電話番号 source の探索 (Issue B-A)", () => {
  it("予約・問い合わせ番号を掲載するページを探す目的指示を含む", () => {
    const prompt = buildStage1Prompt(STORE);
    expect(prompt).toContain("予約・問い合わせ");
    expect(prompt).toContain("電話番号");
  });

  it("coverage floor に「電話番号・予約導線」カテゴリを含む", () => {
    const prompt = buildStage1Prompt(STORE);
    const floorSection = prompt.slice(prompt.indexOf("最低限、以下のカテゴリすべてについて"));
    expect(floorSection).toContain("電話番号・予約導線");
  });

  it("検索クエリ例に「店舗名 + 予約」「店舗名 + 電話番号」を含む", () => {
    const prompt = buildStage1Prompt(STORE);
    expect(prompt).toContain("店舗名 + 予約");
    expect(prompt).toContain("店舗名 + 電話番号");
  });

  it("グルメ/予約ポータルの例示は維持する", () => {
    const prompt = buildStage1Prompt(STORE);
    expect(prompt).toContain("食べログ");
    expect(prompt).toContain("ホットペッパー");
  });

  it("特定店舗名・特定電話番号をハードコードしない", () => {
    const prompt = buildStage1Prompt(STORE);
    expect(prompt).not.toContain("なむら");
    expect(prompt).not.toContain("050-5869-4190");
    expect(prompt).not.toContain("045-305-6536");
  });

  it("見つからないカテゴリを無理に埋めない旨の既存方針を維持する", () => {
    const prompt = buildStage1Prompt(STORE);
    expect(prompt).toContain("すべてに情報源が");
    expect(prompt).toContain("見つからないカテゴリを");
  });
});

/**
 * 食べログ検索の mandatory attempt(PR #180 final smoke hardening、BLOCKER 1)。
 *
 * ## 背景(実機: 関内 なむら / run research_run_msprr298_4sdc9t)
 *
 * 食べログ店舗ページに「予約・お問い合わせ 050-5869-4190」と「電話番号 045-305-6536」の
 * 両方があるにもかかわらず、Source Registry 10件に食べログが1件も入らなかった
 * (Casa BRUTUS / 実食レポ記事 / Retty / Safari Online / competitor 等のみ)。
 *
 * 直前の hardening で `店舗名 + 食べログ` / `店舗名 + 予約` / `店舗名 + 電話番号` の
 * クエリ例と「電話番号・予約導線」coverage floor を追加し、検索行動自体は増えた
 * (search_call_count 2→3 / search_query_count 8→12)。しかしいずれも
 * **「店舗の状況に応じて必要なものを選んでください」という optional 扱い**であり、
 * モデルが Retty 等で coverage を満たしたと判断すると食べログ探索まで到達しない。
 *
 * ## 固定する不変条件
 *
 * - mandatory なのは**検索を試みること**であって、食べログを採用することではない
 * - 検索結果に実際に URL が出た場合のみ SOURCE 候補にする(ID の推測・組み立て禁止)
 * - 食べログが存在しない店舗では通常どおり継続する
 * - 「食べログだから信頼できる/confirmed」にはしない(同定・採否は後続で判定)
 * - 店舗名・URL・電話番号のハードコードをしない
 * - Gemini 呼び出し回数は増やさない(同一 Stage1 prompt 内の指示のみ)
 */
describe("buildStage1Prompt — 食べログ検索の mandatory attempt (BLOCKER 1)", () => {
  const prompt = () => buildStage1Prompt(STORE);

  it("11a. 食べログ検索を必ず試みる mandatory 指示を含む", () => {
    const text = prompt();
    expect(text).toContain("必ず実行する検索");
    expect(text).toContain("site:tabelog.com");
    expect(text).toContain("毎回必ず1回は検索を試みて");
  });

  it("11b. mandatory なのは検索の試行であって採用ではないことを明示する", () => {
    const text = prompt();
    expect(text).toContain("「検索を試みること」であって");
    expect(text).toContain("必ず採用すること」ではありません");
  });

  it("11c. 食べログというだけで信頼できる根拠にはならない旨を明示する", () => {
    expect(prompt()).toContain("掲載されているという事実そのものは");
  });

  it("12. 検索結果に食べログが出なければ SOURCE を出さず通常継続する旨を含む", () => {
    const text = prompt();
    expect(text).toContain("表示されなかった場合");
    expect(text).toContain("通常どおり");
  });

  it("13. 店舗ID推測・組み立て禁止の既存ルールを維持する", () => {
    const text = prompt();
    expect(text).toContain("IDを推測・生成・組み立てることは絶対に禁止");
    expect(text).toContain("検索結果に実際に表示されたURLをそのまま書き写す");
  });

  it("一致した食べログ結果は SOURCE 枠に余裕がある限り優先的に残すよう指示する", () => {
    const text = prompt();
    expect(text).toContain("SOURCE枠に余裕がある限り");
  });

  it("mandatory 化しても店舗名・URL・電話番号をハードコードしない", () => {
    const text = prompt();
    expect(text).not.toContain("なむら");
    expect(text).not.toContain("050-5869-4190");
    expect(text).not.toContain("045-305-6536");
    expect(text).not.toContain("tabelog.com/kanagawa");
  });
});
