/**
 * `phone` 項目の複数番号保持と evidence 裏付け検証
 * (PR #180 final smoke hardening、Issue B)。
 *
 * ## 背景(実機: 関内 なむら)
 *
 * 食べログ店舗ページに「予約・お問い合わせ 050-5869-4190」と
 * 「電話番号 045-305-6536」の**2番号**が掲載されているのに、Research result の
 * `phone.value` は `045-305-6536` の1件だけだった。
 *
 * root cause は `prompts.ts` の `PHONE_ROLE_INSTRUCTION` が
 * 「canonical値を1つ選び(店舗直通番号を優先)、他の番号はevidence内へ補足として記載」
 * と **single value を明示的に要求していた**こと。schema や validation の制約ではない。
 *
 * ## 本ファイルが固定する不変条件
 *
 * 複数番号を役割ラベル付きで保持できるようにする一方、**モデルが実在しない番号を
 * 生成した場合に confirmed にしない**。番号の比較は表記差(ハイフン等)だけを
 * 正規化し、**別番号は同一視しない**。
 */

import { describe, it, expect } from "vitest";
import {
  extractPhoneNumbers,
  enforcePhoneNumbersBackedByEvidence,
} from "../phone-evidence";
import type { ResearchItem } from "@/lib/ai/research-result-schema";

function phoneItem(overrides: Partial<ResearchItem> = {}): ResearchItem {
  return {
    key: "phone",
    research_policy: "FACT",
    status: "confirmed",
    value: "045-305-6536",
    evidence: "食べログの店舗ページに電話番号 045-305-6536 と記載。",
    source_ids: ["S01"],
    ...overrides,
  };
}

describe("extractPhoneNumbers", () => {
  it("ハイフン区切りの日本の電話番号を抽出する", () => {
    expect(extractPhoneNumbers("045-305-6536")).toEqual(["0453056536"]);
  });

  it("複数番号を役割ラベル付き文字列から抽出する", () => {
    expect(
      extractPhoneNumbers("店舗直通: 045-305-6536 / 予約・問い合わせ(食べログ): 050-5869-4190"),
    ).toEqual(["0453056536", "05058694190"]);
  });

  it("表記差(ハイフンなし・全角ハイフン・括弧)を同一視する", () => {
    expect(extractPhoneNumbers("0453056536")).toEqual(["0453056536"]);
    expect(extractPhoneNumbers("045(305)6536")).toEqual(["0453056536"]);
  });

  it("同一番号の表記違いは重複させない", () => {
    expect(extractPhoneNumbers("045-305-6536 / 0453056536")).toEqual(["0453056536"]);
  });

  it("別番号は同一視しない", () => {
    const nums = extractPhoneNumbers("045-305-6536 / 045-305-6537");
    expect(nums).toEqual(["0453056536", "0453056537"]);
  });

  it("電話番号として短すぎる/長すぎる数字列は拾わない", () => {
    expect(extractPhoneNumbers("席数: 49席、2024年6月21日オープン")).toEqual([]);
    expect(extractPhoneNumbers("123456789012345")).toEqual([]);
  });

  it("null / 空文字は空配列", () => {
    expect(extractPhoneNumbers(null)).toEqual([]);
    expect(extractPhoneNumbers("")).toEqual([]);
  });
});

describe("enforcePhoneNumbersBackedByEvidence — 複数番号", () => {

  it("複数番号がすべて evidence に現れていれば confirmed を維持する", () => {
    const item = phoneItem({
      value: "店舗直通: 045-305-6536 / 予約・問い合わせ(食べログ): 050-5869-4190",
      evidence: "食べログに電話番号 045-305-6536、予約・お問い合わせ 050-5869-4190 と記載。",
    });
    const result = enforcePhoneNumbersBackedByEvidence(item);
    expect(result.status).toBe("confirmed");
    expect(result.value).toBe(
      "店舗直通: 045-305-6536 / 予約・問い合わせ(食べログ): 050-5869-4190",
    );
    expect(result.warning).toBeUndefined();
  });

  it("evidence の表記が異なるだけ(ハイフンなし)でも裏付けとみなす", () => {
    const item = phoneItem({
      value: "店舗直通: 045-305-6536 / 予約: 050-5869-4190",
      evidence: "掲載番号は 0453056536 と 05058694190。",
    });
    expect(enforcePhoneNumbersBackedByEvidence(item).status).toBe("confirmed");
  });

  it("evidence に無い番号(モデル生成)が混ざっていたら not_found へ降格する", () => {
    const item = phoneItem({
      value: "店舗直通: 045-305-6536 / 予約: 050-0000-0000",
      evidence: "食べログに電話番号 045-305-6536 と記載。",
    });
    const result = enforcePhoneNumbersBackedByEvidence(item);
    expect(result.status).toBe("not_found");
    expect(result.value).toBeNull();
    expect(result.warning).toContain("根拠");
  });

  it("別番号を同一視しない(下1桁違いは裏付けとみなさない)", () => {
    const item = phoneItem({
      value: "店舗直通: 045-305-6536 / 予約: 050-5869-4190",
      evidence: "掲載番号は 045-305-6536 と 050-5869-4191。",
    });
    expect(enforcePhoneNumbersBackedByEvidence(item).status).toBe("not_found");
  });

  it("confirmed 以外の status には手を加えない", () => {
    for (const status of ["not_found", "conflict", "inferred"] as const) {
      const item = phoneItem({ status, value: "045-305-6536 / 050-0000-0000" });
      expect(enforcePhoneNumbersBackedByEvidence(item)).toBe(item);
    }
  });

  it("phone 以外の key には手を加えない", () => {
    const item = phoneItem({
      key: "nearest_station",
      value: "最寄り駅: 関内駅 / 徒歩3分 050-0000-0000",
      evidence: "駅情報のみ",
    });
    expect(enforcePhoneNumbersBackedByEvidence(item)).toBe(item);
  });
});

/**
 * 単一番号への適用と evidence_basis による経路分離
 * (PR #180 final smoke hardening、Issue B-3)。
 *
 * ## なぜ単一番号にも適用するのか
 *
 * Stage2 prompt に「valueに書いた電話番号は必ずevidenceにも同じ番号を書く」を
 * 追加したため、**AI 生成 phone については単一番号でも同じ要件を課せる**。
 * 電話番号は誤りのコストが特に高い(営業担当が誤った番号へ架電する)ため、
 * false positive より false negative を優先する。
 *
 * ## ただし AI 以外の経路には課さない
 *
 * `evidence_basis` が `places`(Stage0 が Google Places から取得)や
 * `existing_canonical`(登録済み basic_info の fallback)の item は、
 * evidence が AI 生成ではなくコード側の定型文である。ここへ AI 向けの
 * evidence 要件を掛けると**既に動いている経路を退化させる**ため対象外にする。
 */
describe("enforcePhoneNumbersBackedByEvidence — 単一番号と evidence_basis 経路", () => {
  const aiPhone = (value: string, evidence: string, extra: Partial<ResearchItem> = {}) =>
    ({
      key: "phone",
      research_policy: "FACT",
      status: "confirmed",
      value,
      evidence,
      source_ids: ["S01"],
      ...extra,
    }) as ResearchItem;

  it("単一番号 + evidence に番号あり → confirmed のまま", () => {
    const item = aiPhone("045-305-6536", "食べログに電話番号 045-305-6536 と記載。");
    expect(enforcePhoneNumbersBackedByEvidence(item)).toBe(item);
  });

  it("単一番号 + evidence に番号なし → not_found へ safe downgrade", () => {
    const item = aiPhone("045-305-6536", "公式サイトに店舗の電話番号として明記されています。");
    const result = enforcePhoneNumbersBackedByEvidence(item);
    expect(result.status).toBe("not_found");
    expect(result.value).toBeNull();
    expect(result.warning).toContain("根拠");
  });

  it("単一番号 + evidence が表記違い(ハイフンなし)→ confirmed のまま", () => {
    const item = aiPhone("045-305-6536", "掲載番号は 0453056536。");
    expect(enforcePhoneNumbersBackedByEvidence(item).status).toBe("confirmed");
  });

  it("単一番号 + evidence が別番号 → not_found(別番号を同一視しない)", () => {
    const item = aiPhone("045-305-6536", "掲載番号は 045-305-6537。");
    expect(enforcePhoneNumbersBackedByEvidence(item).status).toBe("not_found");
  });

  it("evidence_basis=places の deterministic item は対象外(退化させない)", () => {
    const item = aiPhone("045-305-6536", "今回の調査時点のGoogle Placesで確認した値です。", {
      evidence_basis: "places",
      source_ids: [],
    });
    expect(enforcePhoneNumbersBackedByEvidence(item)).toBe(item);
  });

  it("evidence_basis=existing_canonical の fallback item は対象外(退化させない)", () => {
    const item = aiPhone(
      "店舗直通: 045-305-6536 / 予約: 050-5869-4190",
      "登録済みの基本情報として保持されている値です(最終更新 2026-08-04)。今回のWeb再確認はできていません。",
      { evidence_basis: "existing_canonical", source_ids: [], confidence: null },
    );
    expect(enforcePhoneNumbersBackedByEvidence(item)).toBe(item);
  });

  it("evidence_basis=url_context(AI経路)は対象になる", () => {
    const item = aiPhone("045-305-6536", "公式サイトに記載。", { evidence_basis: "url_context" });
    expect(enforcePhoneNumbersBackedByEvidence(item).status).toBe("not_found");
  });

  it("value に番号が1件も無い場合は何もしない(役割ラベルだけ等)", () => {
    const item = aiPhone("非公開", "電話番号は公開されていません。");
    expect(enforcePhoneNumbersBackedByEvidence(item)).toBe(item);
  });
});
