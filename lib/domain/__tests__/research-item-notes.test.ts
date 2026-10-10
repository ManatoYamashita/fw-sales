/**
 * 調査結果の注記・根拠を利用者向けに変換する純関数のテスト (#301)。
 *
 * 受け入れ条件「画面に内部用語が出ない」「ステータスと注記が矛盾するカードが無い」を守る。
 *
 * ## ガードの組み立て
 *
 * 1. **本番の原文**(2026-10-10 に本番 DB を読み取り専用で走査して採取)を入力にし、
 *    検出器が内部用語を検出できること(否定の対照)と、変換後には検出されないことを確かめる
 * 2. 照合表の全規則の出力と、作る側が export する全定数を検出器に通す。定数はモジュールの
 *    export を走査して集める(手書きの一覧だと、定数を足したときに漏れる)
 * 3. 実際の検証関数を呼んで注記を作らせ、すべて照合表に当たる(`ai` 扱いにならない)ことを
 *    確かめる。作る側の文言と照合表がずれたら、ここで落ちる
 */

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import * as schema from "@/lib/ai/research-result-schema";
import {
  DOWNGRADE_REASON_ACQUISITION,
  DOWNGRADE_REASON_IDENTITY_TARGET,
  SINGLE_CANDIDATE_LEFT_NOTE,
  SOURCE_MARKER_MISMATCH_NOTE,
  UNTRUSTED_CANDIDATE_SOURCE_NOTE,
  enforceResearchPolicy,
  enforceStatusForPolicy,
  enforceStatusValueInvariant,
  flagEvidenceSourceIdMismatch,
  sanitizeSourceIds,
  validateConflictCandidateTrust,
  validateConflictShape,
  validateResearchItemStatus,
  type ResearchItem,
  type SourceRegistryEntry,
} from "@/lib/ai/research-result-schema";
import { enforcePhoneNumbersBackedByEvidence } from "@/lib/ai/research/phone-evidence";
import {
  ITEM_NOTE_RULES,
  deriveItemTrust,
  getVisibleItemNotes,
  parseItemNotes,
  splitNoteSentences,
  stripLegacyEvidenceSupplement,
  toUserFacingRunWarning,
} from "../research-item-notes";

/**
 * 画面に出してはいけない内部用語。英語の status 名・フィールド名・処理名と、
 * 利用者には意味の通らない「格下げ」。
 */
const INTERNAL_TERM =
  /confirmed|inferred|conflict|not_found|hearing_required|external_data_required|research_policy|\bstatus\b|\brun\b|evidence|source_ids|candidate_id|Source Registry|格下げ/;

/** 本番 DB に保存されている注記の原文(連結されたままの形)。 */
const PRODUCTION_WARNINGS = {
  acquisitionOld:
    "AIはconfirmedと判定しましたが、根拠となる情報源の本文取得が確認できなかったため自動的に格下げしました。",
  acquisitionWithPolicyFix:
    "AIはconfirmedと判定しましたが、根拠となる情報源の本文取得が確認できなかったため自動的に格下げしました。 AIが返したresearch_policy(FACT)を正しい値(FACT_OR_HEARING)へ補正しました。",
  statusFixWithPolicyFix:
    "research_policy=FACTに対し不正なstatus(hearing_required)だったためnot_foundへ補正しました。 AIが返したresearch_policy(FACT_OR_HEARING)を正しい値(FACT)へ補正しました。",
  policyFixOnly: "AIが返したresearch_policy(FACT)を正しい値(FACT_OR_HEARING)へ補正しました。",
  identityTarget:
    "AIはconfirmedと判定しましたが、引用された情報源が対象店舗のページであることを確認できなかったため自動的に格下げしました。",
  primarySource:
    "AIはconfirmedと判定しましたが、本人発信の一次情報として確認できなかったため自動的に格下げしました。",
  acquisition:
    "AIはconfirmedと判定しましたが、根拠となる情報源の本文を取得できなかったため自動的に格下げしました。",
  identityCompetitor:
    "AIはconfirmedと判定しましたが、引用された情報源を競合店舗の情報源として確認できなかったため自動的に格下げしました。",
  noCandidateLeft:
    "対象店舗のページとして確認できない情報源のみに依拠した候補を除外しました。 提示できる候補が残らなかったためnot_foundへ補正しました。",
  phoneUnbacked:
    "value に含まれる電話番号の一部が根拠(evidence)に現れないため自動的に格下げしました。",
  /** 関内 なむらの電話番号。#301 の「確認済みなのに不一致」の実例。 */
  namuraPhone:
    "対象店舗のページとして確認できない情報源のみに依拠した候補を除外しました。 残った候補が1つだったため競合を解消しました。 情報源間で電話番号の末尾表記に不一致があります。",
  placesDiff: "登録済みの値(366)と今回のGoogle Places値(367)が異なります。",
  aiConflictNote: "総席数に38席と39席の表記差が存在します。",
} as const;

/** AI が自由に書いた文(照合表に載らないのが正しい)。 */
const AI_SENTENCES = new Set([
  "情報源間で電話番号の末尾表記に不一致があります。",
  "総席数に38席と39席の表記差が存在します。",
]);

describe("検出器の否定の対照 (本番の原文)", () => {
  it.each([
    "acquisitionOld",
    "acquisitionWithPolicyFix",
    "statusFixWithPolicyFix",
    "policyFixOnly",
    "identityTarget",
    "primarySource",
    "acquisition",
    "identityCompetitor",
    "noCandidateLeft",
    "phoneUnbacked",
  ] as const)("%s の原文は内部用語として検出される", (key) => {
    expect(PRODUCTION_WARNINGS[key]).toMatch(INTERNAL_TERM);
  });
});

describe("getVisibleItemNotes (本番の原文)", () => {
  it.each(Object.entries(PRODUCTION_WARNINGS))("%s: 画面に出す文に内部用語が無い", (_, warning) => {
    for (const note of getVisibleItemNotes(warning)) {
      expect(note.text).not.toMatch(INTERNAL_TERM);
    }
  });

  it.each(Object.entries(PRODUCTION_WARNINGS))(
    "%s: AI の自由文以外は照合表に当たる(ai 扱いにならない)",
    (_, warning) => {
      for (const note of parseItemNotes(warning)) {
        if (note.kind === "ai") expect(AI_SENTENCES.has(note.text)).toBe(true);
      }
    },
  );

  it("research_policy / status の補正記録は表示しない", () => {
    expect(getVisibleItemNotes(PRODUCTION_WARNINGS.statusFixWithPolicyFix)).toEqual([]);
    expect(getVisibleItemNotes(PRODUCTION_WARNINGS.policyFixOnly)).toEqual([]);
  });

  it("降格理由は現行の文言へ言い換え、補正記録は落とす", () => {
    expect(getVisibleItemNotes(PRODUCTION_WARNINGS.acquisitionWithPolicyFix)).toEqual([
      { kind: "downgrade", text: DOWNGRADE_REASON_ACQUISITION },
    ]);
  });

  it("なむらの電話番号: 候補の絞り込みは言い換え、AI の不一致の注記はそのまま出す", () => {
    expect(getVisibleItemNotes(PRODUCTION_WARNINGS.namuraPhone)).toEqual([
      { kind: "candidate", text: UNTRUSTED_CANDIDATE_SOURCE_NOTE },
      { kind: "candidate", text: SINGLE_CANDIDATE_LEFT_NOTE },
      { kind: "ai", text: "情報源間で電話番号の末尾表記に不一致があります。" },
    ]);
  });

  it("旧文言と現行文言が同じ文に言い換わる場合は 1 つにまとめる", () => {
    const both = `${DOWNGRADE_REASON_ACQUISITION} ${PRODUCTION_WARNINGS.acquisition}`;
    expect(getVisibleItemNotes(both)).toEqual([
      { kind: "downgrade", text: DOWNGRADE_REASON_ACQUISITION },
    ]);
  });

  it("Places の値の差はそのまま出す (内部用語を含まない)", () => {
    const [note] = getVisibleItemNotes(PRODUCTION_WARNINGS.placesDiff);
    expect(note).toEqual({ kind: "places_diff", text: PRODUCTION_WARNINGS.placesDiff });
    expect(note!.text).not.toMatch(INTERNAL_TERM);
  });

  it("現行の降格理由はそのまま出す", () => {
    expect(getVisibleItemNotes(DOWNGRADE_REASON_IDENTITY_TARGET)).toEqual([
      { kind: "downgrade", text: DOWNGRADE_REASON_IDENTITY_TARGET },
    ]);
  });

  it("注記が無ければ空", () => {
    expect(getVisibleItemNotes(undefined)).toEqual([]);
    expect(getVisibleItemNotes(null)).toEqual([]);
    expect(getVisibleItemNotes("")).toEqual([]);
  });
});

describe("splitNoteSentences", () => {
  it("appendWarning の連結(「。」+ 半角空白)で文に分ける", () => {
    expect(splitNoteSentences("一つ目。 二つ目。 三つ目")).toEqual(["一つ目。", "二つ目。", "三つ目"]);
  });

  it("文中の「。」の直後に空白が無ければ分けない", () => {
    expect(splitNoteSentences("一つ目。二つ目。")).toEqual(["一つ目。二つ目。"]);
  });
});

describe("照合表と作る側の定数", () => {
  /** 作る側が export する注記の定数(名前の規約で集める)。 */
  const generatorConstants: [string, string][] = Object.entries(
    schema as Record<string, unknown>,
  ).flatMap(([name, value]): [string, string][] =>
    typeof value === "string" && (/^DOWNGRADE_REASON_/.test(name) || /_(NOTE|WARNING)$/.test(name))
      ? [[name, value]]
      : [],
  );

  it("走査で定数を集められている (空振りしていない)", () => {
    // 降格理由 6・電話番号 2・候補 4・出典の書き方 1
    expect(generatorConstants.length).toBe(13);
  });

  it.each(generatorConstants)("%s は内部用語を含まない", (_, text) => {
    expect(text).not.toMatch(INTERNAL_TERM);
  });

  it.each(generatorConstants)("%s は照合表に表示用の文として載っている", (_, text) => {
    const [note] = parseItemNotes(text);
    expect(note).toBeDefined();
    expect(note!.kind).not.toBe("ai");
    expect(note!.kind).not.toBe("internal");
    expect(note!.text).toBe(text);
  });

  it("表示する規則の言い換え後の文に内部用語が無い", () => {
    for (const rule of ITEM_NOTE_RULES) {
      if (rule.kind === "internal") continue;
      const output = rule.text ?? (typeof rule.match === "string" ? rule.match : null);
      if (output === null) continue; // 正規表現でそのまま出す規則は、下の places_diff で確かめる
      expect(output).not.toMatch(INTERNAL_TERM);
    }
  });
});

/* ------------------------------------------------------------------ */
/*  作る側の関数が実際に付ける注記がすべて照合表に当たること             */
/* ------------------------------------------------------------------ */

function makeSource(overrides: Partial<SourceRegistryEntry> = {}): SourceRegistryEntry {
  return {
    id: "S01",
    title: "gnavi.co.jp",
    grounding_redirect_url: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc",
    resolved_url: null,
    resolve_status: "failed",
    source_type: "official_site",
    discovery_provenance: "google_grounding",
    url_context_status: "success",
    identity_status: "target_match",
    ...overrides,
  };
}

function makeItem(overrides: Partial<ResearchItem> = {}): ResearchItem {
  return {
    key: "business_hours_holidays",
    research_policy: "FACT",
    status: "confirmed",
    value: "17:00-24:00",
    evidence: "公式サイトに明記",
    source_ids: ["S01"],
    ...overrides,
  };
}

describe("作る側の関数が付ける注記", () => {
  const phoneConflict = (candidateSources: string[][]): ResearchItem =>
    makeItem({
      key: "phone",
      status: "conflict",
      value: null,
      source_ids: [],
      candidates: candidateSources.map((source_ids, i) => ({
        candidate_id: `c${i}`,
        label: `候補${i}`,
        value: i === 0 ? "045-305-6536" : "045-305-6539",
        evidence: i === 0 ? "045-305-6536 と記載。" : "045-305-6539 と記載。",
        source_ids,
      })),
    });

  const cases: [string, () => ResearchItem][] = [
    ["research_policy の補正", () => enforceResearchPolicy(makeItem({ research_policy: "ANALYSIS" }))],
    [
      "status の補正",
      () => enforceStatusForPolicy(makeItem({ research_policy: "FACT", status: "hearing_required" })),
    ],
    [
      "値が空の status 補正",
      () => enforceStatusValueInvariant(makeItem({ value: "  " })),
    ],
    ["存在しない出典の除去", () => sanitizeSourceIds(makeItem({ source_ids: ["S99"] }), [makeSource()])],
    [
      "競合の形の不備",
      () => validateConflictShape(makeItem({ status: "conflict", candidates: [] })),
    ],
    [
      "降格(本文を読み込めない)",
      () =>
        validateResearchItemStatus(makeItem(), {
          sourceRegistry: [makeSource({ url_context_status: "error" })],
        }),
    ],
    [
      "降格(店舗のページと確かめられない)",
      () =>
        validateResearchItemStatus(makeItem(), {
          sourceRegistry: [makeSource({ identity_status: "uncertain" })],
        }),
    ],
    [
      "候補の絞り込みで 1 つ残る",
      () =>
        validateConflictCandidateTrust(phoneConflict([["S01"], ["S02"]]), {
          sourceRegistry: [makeSource(), makeSource({ id: "S02", identity_status: "uncertain" })],
        }),
    ],
    [
      "候補の絞り込みで何も残らない",
      () =>
        validateConflictCandidateTrust(phoneConflict([["S02"], ["S03"]]), {
          sourceRegistry: [
            makeSource({ id: "S02", identity_status: "uncertain" }),
            makeSource({ id: "S03", identity_status: "uncertain" }),
          ],
        }),
    ],
    [
      "根拠の文中の出典番号の食い違い",
      () => flagEvidenceSourceIdMismatch(makeItem({ evidence: "S05によると", source_ids: ["S01"] })),
    ],
    [
      "電話番号が根拠に無い",
      () =>
        enforcePhoneNumbersBackedByEvidence(
          makeItem({ key: "phone", value: "045-305-6536", evidence: "電話は 03-1111-2222" }),
        ),
    ],
  ];

  it.each(cases)("%s: 注記が付き、照合表に当たり、表示する文に内部用語が無い", (_, produce) => {
    const item = produce();
    // 注記が付かないと照合の検査が空振りする。入力の作り方が古くなっていないかをここで止める。
    expect(item.warning).toBeTruthy();
    for (const note of parseItemNotes(item.warning)) {
      expect(note.kind).not.toBe("ai");
      if (note.kind !== "internal") expect(note.text).not.toMatch(INTERNAL_TERM);
    }
  });
});

describe("deriveItemTrust", () => {
  it("注記の無い confirmed は確認済み", () => {
    expect(deriveItemTrust(makeItem())).toBe("confirmed");
  });

  it("登録済みの値を折り返した confirmed は登録済み", () => {
    expect(deriveItemTrust(makeItem({ evidence_basis: "existing_canonical" }))).toBe("registered");
  });

  it("AI の不一致の注記が付いた confirmed は注記あり (なむらの電話番号)", () => {
    expect(deriveItemTrust(makeItem({ warning: PRODUCTION_WARNINGS.namuraPhone }))).toBe("noted");
  });

  it("出典の書き方の食い違いが付いた confirmed は注記あり", () => {
    expect(deriveItemTrust(makeItem({ warning: SOURCE_MARKER_MISMATCH_NOTE }))).toBe("noted");
  });

  it.each([
    ["research_policy の補正", PRODUCTION_WARNINGS.policyFixOnly],
    ["Places の値の差", PRODUCTION_WARNINGS.placesDiff],
    ["候補を 1 つに絞った記録", `${UNTRUSTED_CANDIDATE_SOURCE_NOTE} ${SINGLE_CANDIDATE_LEFT_NOTE}`],
  ])("%s だけなら確認済みのまま", (_, warning) => {
    expect(deriveItemTrust(makeItem({ warning }))).toBe("confirmed");
  });

  it("inferred / conflict はそのまま", () => {
    expect(deriveItemTrust(makeItem({ status: "inferred" }))).toBe("inferred");
    expect(deriveItemTrust(makeItem({ status: "conflict" }))).toBe("conflict");
  });

  it.each(["not_found", "hearing_required", "external_data_required"] as const)(
    "%s はレビュー対象外なので null",
    (status) => {
      expect(deriveItemTrust(makeItem({ status }))).toBeNull();
    },
  );
});

describe("stripLegacyEvidenceSupplement", () => {
  it("媒体名に括弧を含む旧 run の付記も末尾まで取り除く (本番の原文)", () => {
    const evidence =
      "S01自社WebとS04、S05、S07、S08、S09などの複数ポータル・地域メディアへの掲載が確認されるため。 (このrunで実際に本文を確認できた情報源: 公式サイト(登録情報)、東北メシ 炉端ジュン(柏/居酒屋)＜ネット予約可＞ | ホットペッパーグルメ、個室あり × 東北メシ 炉端 ジュン（柏/居酒屋） - 楽天ぐるなび)";
    expect(stripLegacyEvidenceSupplement(evidence)).toBe(
      "S01自社WebとS04、S05、S07、S08、S09などの複数ポータル・地域メディアへの掲載が確認されるため。",
    );
  });

  it("付記が無ければ変えない", () => {
    expect(stripLegacyEvidenceSupplement("公式サイト(2024年)に明記")).toBe("公式サイト(2024年)に明記");
  });
});

describe("toUserFacingRunWarning", () => {
  it("種別コードを取り除く (本番の原文)", () => {
    expect(
      toUserFacingRunWarning(
        "Google Places候補が一意に特定できませんでした (places_search_no_match)。既存情報のみで調査を続行します。",
      ),
    ).toBe("Google Places候補が一意に特定できませんでした。既存情報のみで調査を続行します。");
    expect(toUserFacingRunWarning("Google Places検索に失敗しました (api_error:500)。")).toBe(
      "Google Places検索に失敗しました。",
    );
  });

  it("日本語の括弧書きは残す", () => {
    const text =
      "Google Placesの店舗情報を再取得できませんでした(該当なし)。既存情報のみで調査を続行します。";
    expect(toUserFacingRunWarning(text)).toBe(text);
  });
});
