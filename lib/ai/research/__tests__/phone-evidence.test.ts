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
  isConflictCandidateEvidenceBacked,
} from "../phone-evidence";
import type { ResearchItem, ResearchItemCandidate } from "@/lib/ai/research-result-schema";

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

/**
 * Unicode 表記差の吸収(PR #180 final merge-blocker fix、F3 Bug A)。
 *
 * 監査で、`PHONE_LIKE_PATTERN` が先頭・末尾を ASCII `[0-9]` に固定し、
 * `normalizePhone` の `\d` も ASCII 限定であるため、**全角数字の電話番号が
 * 1件も抽出されず evidence 裏付け検査を素通りする**ことが実測で確認された。
 * 混在ケース(片方が全角)では ASCII 側だけが検査され、全角側は無検査で
 * canonical へ到達しうる。
 *
 * `U+2212`(MINUS SIGN)は **NFKC では変換されない**ことも実測で確認済み
 * (`identity-match.ts:unifyDashLikeChars` の JSDoc が Google Places 応答で
 * 同じ事実を記録している)。したがって NFKC だけでは不十分で、
 * dash-like Unicode の統一が併せて必要になる。
 */
describe("extractPhoneNumbers — Unicode 表記差(F3 Bug A)", () => {
  const EXPECTED_045 = ["0453056536"];

  it.each([
    ["ASCII ハイフン", "045-305-6536"],
    ["全角数字 + 全角ハイフン(U+FF0D)", "０４５－３０５－６５３６"],
    ["半角括弧", "(045) 305-6536"],
    ["空白区切り", "045 305 6536"],
    ["MINUS SIGN(U+2212)", "045−305−6536"],
    ["HYPHEN(U+2010)", "045‐305‐6536"],
    ["全角括弧 + 全角数字", "（０４５）３０５－６５３６"],
  ])("%s の 045 番号を同一の正規化結果へ吸収する", (_label, input) => {
    expect(extractPhoneNumbers(input)).toEqual(EXPECTED_045);
  });

  it.each([
    ["ASCII", "050-5869-4190"],
    ["全角", "０５０－５８６９－４１９０"],
    ["MINUS SIGN", "050−5869−4190"],
  ])("%s の 050 番号を抽出する", (_label, input) => {
    expect(extractPhoneNumbers(input)).toEqual(["05058694190"]);
  });

  it("全角と ASCII が混在する複数番号を2件とも抽出する(片方だけ検査される穴を塞ぐ)", () => {
    expect(
      extractPhoneNumbers("店舗直通: ０４５－３０５－６５３６ / 予約: 050-5869-4190"),
    ).toEqual(["0453056536", "05058694190"]);
  });

  it("表記だけが違う同一番号は重複させない(全角 + ASCII)", () => {
    expect(extractPhoneNumbers("０４５－３０５－６５３６ / 045-305-6536")).toEqual(EXPECTED_045);
  });

  it("正規化しても桁数レンジ(10〜11桁)の判定は変わらない", () => {
    // 全角の席数・年月日を電話番号として拾わない。
    expect(extractPhoneNumbers("席数: ４９席、２０２４年６月２１日オープン")).toEqual([]);
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

  /**
   * ## 意図的な仕様変更(PR #180 final merge-blocker fix、F3)
   *
   * 旧仕様は「value に番号が1件も無ければ何もしない」だった(`numbersInValue.length === 0`
   * を vacuous に `true` としていた)。しかし `phone` は FACT であり、canonical
   * `stores.basic_info.phone` の contract は**架電可能な番号**である。
   * 「非公開」「未掲載」「不明」「-」といった非番号文字列が AI 生成の confirmed として
   * canonical へ入る経路を閉じるため、AI 生成経路では **番号1件以上**を必須にする。
   *
   * 「掲載が無かった」という調査情報は `evidence` に残るため失われない。
   * FACT の status 空間に「確認できた不在」を表す値が無い以上、
   * false positive より false negative を優先する既存方針に沿う判断である。
   */
  it.each(["非公開", "未掲載", "不明", "-", "電話番号の記載なし", ""])(
    "AI生成の confirmed phone で value=%p(電話番号0件)は confirmed を維持しない",
    (value) => {
      const result = enforcePhoneNumbersBackedByEvidence(
        aiPhone(value, "店舗ページに電話番号の掲載がありませんでした。"),
      );
      expect(result.status).toBe("not_found");
      expect(result.value).toBeNull();
      expect(result.confidence).toBeNull();
      expect(result.warning).toBeTruthy();
    },
  );

  it("電話番号0件で降格しても evidence は調査情報として残す", () => {
    const evidence = "店舗ページに電話番号の掲載がありませんでした。";
    const result = enforcePhoneNumbersBackedByEvidence(aiPhone("非公開", evidence));
    expect(result.evidence).toBe(evidence);
  });

  it("evidence_basis=places / existing_canonical は電話番号0件でも対象外(例外を拡張しない)", () => {
    for (const basis of ["places", "existing_canonical"] as const) {
      const item = aiPhone("非公開", "コード側の定型文。", { evidence_basis: basis });
      expect(enforcePhoneNumbersBackedByEvidence(item)).toBe(item);
    }
  });

  it("phone 以外の key は電話番号0件でも降格しない", () => {
    const item = aiPhone("49席", "公式サイトに49席と記載。", { key: "seat_count" });
    expect(enforcePhoneNumbersBackedByEvidence(item)).toBe(item);
  });

  it("value が全角 / evidence が ASCII の同一番号 → confirmed のまま(表記差は同一視)", () => {
    const item = aiPhone("０４５－３０５－６５３６", "食べログに電話番号 045-305-6536 と記載。");
    expect(enforcePhoneNumbersBackedByEvidence(item).status).toBe("confirmed");
  });

  it("value が ASCII / evidence が全角の同一番号 → confirmed のまま", () => {
    const item = aiPhone("045-305-6536", "食べログに電話番号 ０４５－３０５－６５３６ と記載。");
    expect(enforcePhoneNumbersBackedByEvidence(item).status).toBe("confirmed");
  });

  it("value が全角 / evidence が別番号 → not_found(正規化しても別番号は同一視しない)", () => {
    const item = aiPhone("０４５－３０５－６５３６", "掲載番号は 045-305-6537。");
    expect(enforcePhoneNumbersBackedByEvidence(item).status).toBe("not_found");
  });

  it("全角 + ASCII 混在の複数番号で片方だけ evidence に無ければ not_found(全角側も検査される)", () => {
    const item = aiPhone(
      "店舗直通: ０４５－３０５－６５３６ / 予約: 050-5869-4190",
      "予約番号は 050-5869-4190 のみ記載。",
    );
    expect(enforcePhoneNumbersBackedByEvidence(item).status).toBe("not_found");
  });

  it("全角 + ASCII 混在の複数番号が両方 evidence にあれば confirmed のまま", () => {
    const item = aiPhone(
      "店舗直通: ０４５－３０５－６５３６ / 予約: 050-5869-4190",
      "電話番号 045-305-6536、予約 ０５０－５８６９－４１９０ と記載。",
    );
    expect(enforcePhoneNumbersBackedByEvidence(item).status).toBe("confirmed");
  });
});

/**
 * conflict candidate への同じ AI 自己整合性チェック
 * (PR #180 final smoke hardening、BLOCKER 2 の candidate evidence 検証)。
 *
 * `enforcePhoneNumbersBackedByEvidence` は `status === "confirmed"` だけを対象にする
 * ため、`status === "conflict"` の各 candidate には効かない。conflict でも
 * 「candidate.value に書いた番号は candidate.evidence にも書く」という同じ要件を課し、
 * 満たさない candidate は trusted candidate として扱わない。
 *
 * ## trust level(confirmed 側と同じ限界)
 *
 * これは **AI 自己整合性チェック**であって source 本文の deterministic 照合ではない。
 * URL Context は取得したページ本文をアプリコードへ返さないため、value と evidence の
 * 両方へ同じ hallucinated 番号が書かれた場合は検出できない。source 側の信頼性は
 * `research-result-schema.ts:isVerifiedSourceForItem`(url_context 成功 + identity)が担う。
 */
describe("isConflictCandidateEvidenceBacked", () => {
  const conflictPhone = (overrides: Partial<ResearchItem> = {}): ResearchItem =>
    ({
      key: "phone",
      research_policy: "FACT",
      status: "conflict",
      value: null,
      evidence: "情報源間で電話番号が食い違います。",
      source_ids: [],
      ...overrides,
    }) as ResearchItem;

  const candidate = (
    value: string,
    evidence: string,
    overrides: Partial<ResearchItemCandidate> = {},
  ): ResearchItemCandidate => ({
    candidate_id: "a",
    label: "候補A",
    value,
    evidence,
    source_ids: ["S01"],
    ...overrides,
  });

  it("8. candidate.value の番号が candidate.evidence に無ければ false", () => {
    const result = isConflictCandidateEvidenceBacked(
      conflictPhone(),
      candidate("045-305-6539", "別の情報源に掲載されていました。"),
    );
    expect(result).toBe(false);
  });

  it("candidate.value の番号が candidate.evidence にあれば true", () => {
    const result = isConflictCandidateEvidenceBacked(
      conflictPhone(),
      candidate("045-305-6536", "食べログに電話番号 045-305-6536 と記載。"),
    );
    expect(result).toBe(true);
  });

  it("9. 表記差(ハイフンの有無)は同一とみなす", () => {
    expect(
      isConflictCandidateEvidenceBacked(
        conflictPhone(),
        candidate("045-305-6536", "掲載番号は 0453056536。"),
      ),
    ).toBe(true);
  });

  it("別番号は同一視しない(下1桁違いは裏付けとみなさない)", () => {
    expect(
      isConflictCandidateEvidenceBacked(
        conflictPhone(),
        candidate("045-305-6536", "掲載番号は 045-305-6537。"),
      ),
    ).toBe(false);
  });

  it("複数番号の candidate は全ての番号が evidence に現れる場合のみ true", () => {
    expect(
      isConflictCandidateEvidenceBacked(
        conflictPhone(),
        candidate(
          "店舗直通: 045-305-6536 / 予約: 050-5869-4190",
          "045-305-6536 と 050-5869-4190 の2番号が併記。",
        ),
      ),
    ).toBe(true);
    expect(
      isConflictCandidateEvidenceBacked(
        conflictPhone(),
        candidate("店舗直通: 045-305-6536 / 予約: 050-5869-4190", "045-305-6536 のみ記載。"),
      ),
    ).toBe(false);
  });

  it("phone 以外の key には適用しない(常に true)", () => {
    expect(
      isConflictCandidateEvidenceBacked(
        conflictPhone({ key: "seat_count" }),
        candidate("49席", "根拠に番号は現れない。"),
      ),
    ).toBe(true);
  });

  /**
   * ## 意図的な仕様変更(PR #180 final merge-blocker fix、F3)
   *
   * confirmed 側と同じ理由で、conflict candidate も **番号1件以上**を必須にする。
   * candidate は選択されればそのまま canonical `basic_info.phone` へ入るため、
   * confirmed 側だけを締めると非番号値がむしろ通りやすい経路になる。
   */
  it.each(["非公開", "未掲載", "不明", "-", ""])(
    "value=%p(電話番号0件)の candidate は trusted candidate として扱わない",
    (value) => {
      expect(isConflictCandidateEvidenceBacked(conflictPhone(), candidate(value, "掲載なし。"))).toBe(
        false,
      );
    },
  );

  it("candidate.value が全角 / evidence が ASCII の同一番号なら true", () => {
    expect(
      isConflictCandidateEvidenceBacked(
        conflictPhone(),
        candidate("０４５－３０５－６５３６", "食べログに 045-305-6536 と記載。"),
      ),
    ).toBe(true);
  });

  it("candidate.value が MINUS SIGN 区切りでも evidence と一致すれば true", () => {
    expect(
      isConflictCandidateEvidenceBacked(
        conflictPhone(),
        candidate("045−305−6536", "掲載番号は 045-305-6536。"),
      ),
    ).toBe(true);
  });

  it("全角 candidate が evidence の別番号としか一致しなければ false", () => {
    expect(
      isConflictCandidateEvidenceBacked(
        conflictPhone(),
        candidate("０４５－３０５－６５３６", "掲載番号は 045-305-6537。"),
      ),
    ).toBe(false);
  });

  it("全角 + ASCII 混在の複数番号 candidate は全番号が evidence にある場合のみ true", () => {
    expect(
      isConflictCandidateEvidenceBacked(
        conflictPhone(),
        candidate(
          "店舗直通: ０４５－３０５－６５３６ / 予約: 050-5869-4190",
          "045-305-6536 と ０５０－５８６９－４１９０ の2番号が併記。",
        ),
      ),
    ).toBe(true);
    expect(
      isConflictCandidateEvidenceBacked(
        conflictPhone(),
        candidate(
          "店舗直通: ０４５－３０５－６５３６ / 予約: 050-5869-4190",
          "050-5869-4190 のみ記載。",
        ),
      ),
    ).toBe(false);
  });

  it("evidence_basis が places / existing_canonical の item は対象外(退化させない)", () => {
    for (const basis of ["places", "existing_canonical"] as const) {
      expect(
        isConflictCandidateEvidenceBacked(
          conflictPhone({ evidence_basis: basis }),
          candidate("045-305-6536", "コード側の定型文(番号を含まない)。"),
        ),
      ).toBe(true);
    }
  });
});

/**
 * 10. 用途が異なる2番号は conflict ではなく1 value へ併記する
 * (050 + 045 semantics、既存方針の維持を固定する回帰テスト)。
 */
describe("050(予約) + 045(店舗直通)の併記セマンティクス", () => {
  it("用途ラベル付きの併記 value は confirmed のまま維持される(conflict化しない)", () => {
    const item: ResearchItem = {
      key: "phone",
      research_policy: "FACT",
      status: "confirmed",
      value: "店舗直通: 045-305-6536 / 予約・問い合わせ(食べログ): 050-5869-4190",
      evidence: "食べログに電話番号 045-305-6536、予約・お問い合わせ 050-5869-4190 と記載。",
      source_ids: ["S01"],
      evidence_basis: "url_context",
    };
    const result = enforcePhoneNumbersBackedByEvidence(item);
    expect(result.status).toBe("confirmed");
    expect(result.candidates).toBeUndefined();
    expect(extractPhoneNumbers(result.value)).toEqual(["0453056536", "05058694190"]);
  });
});
