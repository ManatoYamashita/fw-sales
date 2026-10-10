/**
 * 調査結果の注記(`ResearchItem.warning`)・根拠(`evidence`)を、調査レビュー画面に
 * 出せる形へ変換する純関数群 (#301)。
 *
 * ## なぜ表示時に変換するのか
 *
 * 注記は調査パイプライン(`lib/ai/research-result-schema.ts` ほか)が固定文を
 * `appendWarning` で前へ連結して作り、**文字列のまま `store_research_runs.result` に保存される**。
 * 作る側の文言を直しても、保存済みの run には効かない。本番には
 * 「AIはconfirmedと判定しましたが…自動的に格下げしました」のような内部用語の注記が
 * 数百件残っているため、表示する直前に文単位で照合して言い換える。
 *
 * ## 注記の種類
 *
 * - `internal`    : 検証処理の後始末の記録(research_policy の補正、重複候補の除去など)。
 *                   利用者が判断に使う情報ではないので**表示しない**。DB には残る。
 * - `downgrade`   : AI が確認済みとした値を、根拠不足で確認済みにしなかった理由
 * - `candidate`   : 競合候補を絞り込んだ記録
 * - `places_diff` : 登録済みの値と今回の Google Places の値の差
 * - `caution`     : 検証処理が付けた注意(出典の書き方の食い違い)
 * - `ai`          : 照合表のどれにも当たらない文。AI が自由に書いた注記として扱う
 *
 * `caution` と `ai` は「確認済み」と並べると矛盾して見えるため、`deriveItemTrust` は
 * これらが付いた confirmed を `noted`(注記あり)にする。
 *
 * Client Component から import する。`server-only` に依存するモジュールを import しないこと。
 */

import {
  DOWNGRADE_REASON_ACQUISITION,
  DOWNGRADE_REASON_IDENTITY_COMPETITOR,
  DOWNGRADE_REASON_IDENTITY_CONTEXTUAL,
  DOWNGRADE_REASON_IDENTITY_TARGET,
  DOWNGRADE_REASON_PRIMARY_SOURCE,
  DOWNGRADE_REASON_SOURCE_ELIGIBILITY,
  NO_CANDIDATE_LEFT_NOTE,
  PHONE_NOT_A_NUMBER_WARNING,
  PHONE_UNBACKED_WARNING,
  SINGLE_CANDIDATE_LEFT_NOTE,
  SOURCE_MARKER_MISMATCH_NOTE,
  UNBACKED_CANDIDATE_EVIDENCE_NOTE,
  UNTRUSTED_CANDIDATE_SOURCE_NOTE,
} from "@/lib/ai/research-result-schema";
import type { ResearchItem } from "@/types/research-run";

export type ItemNoteKind =
  | "internal"
  | "downgrade"
  | "candidate"
  | "places_diff"
  | "caution"
  | "ai";

export interface ItemNote {
  kind: ItemNoteKind;
  /** 画面に出す文。`internal` では元の文をそのまま持つ(表示はしない)。 */
  text: string;
}

interface NoteRule {
  kind: ItemNoteKind;
  match: string | RegExp;
  /** 言い換え後の文。省略時は元の文をそのまま使う。 */
  text?: string;
}

/**
 * 照合表。現行の文言(作る側の定数)と、本番に保存されている旧文言の両方を持つ。
 *
 * 旧文言は**本番 DB に実際に保存されている原文**をそのまま書く(2026-10-10 に読み取り専用で
 * 全 succeeded run を走査して採取)。言い回しを推測で書くと、照合に失敗して
 * `ai` 扱いになり、内部用語がそのまま画面に出る。
 */
const NOTE_RULES: readonly NoteRule[] = [
  // --- downgrade: 現行 ---
  { kind: "downgrade", match: DOWNGRADE_REASON_ACQUISITION },
  { kind: "downgrade", match: DOWNGRADE_REASON_IDENTITY_TARGET },
  { kind: "downgrade", match: DOWNGRADE_REASON_IDENTITY_COMPETITOR },
  { kind: "downgrade", match: DOWNGRADE_REASON_IDENTITY_CONTEXTUAL },
  { kind: "downgrade", match: DOWNGRADE_REASON_SOURCE_ELIGIBILITY },
  { kind: "downgrade", match: DOWNGRADE_REASON_PRIMARY_SOURCE },
  { kind: "downgrade", match: PHONE_UNBACKED_WARNING },
  { kind: "downgrade", match: PHONE_NOT_A_NUMBER_WARNING },
  // --- downgrade: 旧文言 ---
  {
    kind: "downgrade",
    match:
      "AIはconfirmedと判定しましたが、根拠となる情報源の本文取得が確認できなかったため自動的に格下げしました。",
    text: DOWNGRADE_REASON_ACQUISITION,
  },
  {
    kind: "downgrade",
    match:
      "AIはconfirmedと判定しましたが、根拠となる情報源の本文を取得できなかったため自動的に格下げしました。",
    text: DOWNGRADE_REASON_ACQUISITION,
  },
  {
    kind: "downgrade",
    match:
      "AIはconfirmedと判定しましたが、引用された情報源が対象店舗のページであることを確認できなかったため自動的に格下げしました。",
    text: DOWNGRADE_REASON_IDENTITY_TARGET,
  },
  {
    kind: "downgrade",
    match:
      "AIはconfirmedと判定しましたが、引用された情報源を競合店舗の情報源として確認できなかったため自動的に格下げしました。",
    text: DOWNGRADE_REASON_IDENTITY_COMPETITOR,
  },
  {
    kind: "downgrade",
    match:
      "AIはconfirmedと判定しましたが、引用された情報源を対象店舗または商圏・市場の情報源として確認できなかったため自動的に格下げしました。",
    text: DOWNGRADE_REASON_IDENTITY_CONTEXTUAL,
  },
  {
    kind: "downgrade",
    match:
      "AIはconfirmedと判定しましたが、確認済みとして扱うために必要な情報源の条件を満たさなかったため自動的に格下げしました。",
    text: DOWNGRADE_REASON_SOURCE_ELIGIBILITY,
  },
  {
    kind: "downgrade",
    match:
      "AIはconfirmedと判定しましたが、本人発信の一次情報として確認できなかったため自動的に格下げしました。",
    text: DOWNGRADE_REASON_PRIMARY_SOURCE,
  },
  {
    kind: "downgrade",
    match: "value に含まれる電話番号の一部が根拠(evidence)に現れないため自動的に格下げしました。",
    text: PHONE_UNBACKED_WARNING,
  },
  {
    kind: "downgrade",
    match: "電話番号として解釈できる値が含まれていないため自動的に格下げしました。",
    text: PHONE_NOT_A_NUMBER_WARNING,
  },

  // --- candidate: 現行 ---
  { kind: "candidate", match: UNTRUSTED_CANDIDATE_SOURCE_NOTE },
  { kind: "candidate", match: UNBACKED_CANDIDATE_EVIDENCE_NOTE },
  { kind: "candidate", match: NO_CANDIDATE_LEFT_NOTE },
  { kind: "candidate", match: SINGLE_CANDIDATE_LEFT_NOTE },
  // --- candidate: 旧文言 ---
  {
    kind: "candidate",
    match: "対象店舗のページとして確認できない情報源のみに依拠した候補を除外しました。",
    text: UNTRUSTED_CANDIDATE_SOURCE_NOTE,
  },
  {
    kind: "candidate",
    match: "根拠(evidence)に現れない値を含む候補を除外しました。",
    text: UNBACKED_CANDIDATE_EVIDENCE_NOTE,
  },
  {
    kind: "candidate",
    match: /^提示できる候補が残らなかったため[a-z_]+へ補正しました。$/,
    text: NO_CANDIDATE_LEFT_NOTE,
  },
  {
    kind: "candidate",
    match: "残った候補が1つだったため競合を解消しました。",
    text: SINGLE_CANDIDATE_LEFT_NOTE,
  },

  // --- caution ---
  { kind: "caution", match: SOURCE_MARKER_MISMATCH_NOTE },
  {
    kind: "caution",
    match: "evidence内の出典表記がsource_idsと一致しない可能性があります。",
    text: SOURCE_MARKER_MISMATCH_NOTE,
  },

  // --- places_diff (`lib/ai/research/pipeline.ts` の Places 由来 item) ---
  { kind: "places_diff", match: /^登録済みの値\([\s\S]*\)と今回のGoogle Places値\([\s\S]*\)が異なります。$/ },

  // --- internal: 検証処理の後始末。表示しない ---
  { kind: "internal", match: /^未知のkey "[\s\S]*" のためこの項目は無効化されました。$/ },
  { kind: "internal", match: /^AIが返したresearch_policy\([A-Z_]+\)を正しい値\([A-Z_]+\)へ補正しました。$/ },
  { kind: "internal", match: "Source Registryに存在しない出典IDが参照されていたため除去しました。" },
  {
    kind: "internal",
    match:
      "AIがconflictと判定しましたが、実質的に競合する候補(2件以上・異なる値)が揃わなかったため無効化しました。",
  },
  { kind: "internal", match: "重複したcandidate_idを除去しました。" },
  {
    kind: "internal",
    match: /^research_policy=[A-Z_]+の項目はAIがconfirmedと判定できないため自動的に格下げしました。$/,
  },
  {
    kind: "internal",
    match: /^research_policy=[A-Z_]+に対し不正なstatus\([a-z_]+\)だったため[a-z_]+へ補正しました。$/,
  },
  { kind: "internal", match: /^status=[a-z_]+ですが値が空だったため[a-z_]+へ補正しました。$/ },
];

/** 照合表の全規則。ガードテストが「画面に出る文に内部用語が無いこと」を検査するために公開する。 */
export const ITEM_NOTE_RULES: readonly Readonly<NoteRule>[] = NOTE_RULES;

/**
 * 連結された注記を文に分ける。`appendWarning` は文を半角空白 1 つで前へ連結するため、
 * 「。」の直後の空白で切る。
 */
export function splitNoteSentences(warning: string | null | undefined): string[] {
  if (typeof warning !== "string") return [];
  // 後読み(`(?<=。)`)は tsconfig の target(ES2017)で使えないため、区切りを改行へ置き換えてから分ける。
  return warning
    .replace(/。\s+/g, "。\n")
    .split("\n")
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence !== "");
}

function classifySentence(sentence: string): ItemNote {
  for (const rule of NOTE_RULES) {
    const hit = typeof rule.match === "string" ? rule.match === sentence : rule.match.test(sentence);
    if (hit) return { kind: rule.kind, text: rule.text ?? sentence };
  }
  return { kind: "ai", text: sentence };
}

/** 注記を文ごとに分類する。`internal` も含めて返す(表示には `getVisibleItemNotes` を使う)。 */
export function parseItemNotes(warning: string | null | undefined): ItemNote[] {
  return splitNoteSentences(warning).map(classifySentence);
}

/**
 * 画面に出す注記だけを返す。`internal` を除き、言い換え後に同じ文になったもの
 * (旧文言と現行文言が両方付いた run など)は 1 つにまとめる。
 */
export function getVisibleItemNotes(warning: string | null | undefined): ItemNote[] {
  const seen = new Set<string>();
  const visible: ItemNote[] = [];
  for (const note of parseItemNotes(warning)) {
    if (note.kind === "internal" || seen.has(note.text)) continue;
    seen.add(note.text);
    visible.push(note);
  }
  return visible;
}

/**
 * 旧 run の `own_net_exposure` / `exposure_gap` の evidence 末尾に付いている
 * 「(このrunで実際に本文を確認できた情報源: …)」を取り除く。
 *
 * 同じ媒体一覧は value の先頭(「確認できた掲載媒体: …。」)にも入っており、二重に表示されていた。
 * 媒体名に括弧が含まれうる(例: 「公式サイト(登録情報)」)ため、末尾の閉じ括弧まで貪欲に取る。
 */
export function stripLegacyEvidenceSupplement(evidence: string): string {
  return evidence.replace(/\s*\(このrunで実際に本文を確認できた情報源: [\s\S]*\)\s*$/, "");
}

/**
 * run 全体の警告(`run.warnings`)から、診断用の種別コードを取り除く。
 *
 * `lib/ai/research/places-stage0.ts` は「Google Places検索に失敗しました (api_error:500)。」の
 * ように種別を括弧で付ける。診断はログ側で行うため、画面には出さない。
 */
export function toUserFacingRunWarning(warning: string): string {
  return warning.replace(/\s*\([a-z][a-z0-9_]*(?::[0-9]+)?\)/g, "");
}

/** レビュー対象の項目を、画面のバッジでどう見せるか。 */
export type ItemTrust = "registered" | "noted" | "confirmed" | "inferred" | "conflict";

export const ITEM_TRUST_LABELS: Record<ItemTrust, string> = {
  registered: "登録済み",
  noted: "注記あり",
  confirmed: "確認済み",
  inferred: "推定",
  conflict: "競合",
};

/**
 * レビュー対象の項目の見せ方を決める。レビュー対象外(確認できず等)は `null`。
 *
 * - confirmed でも、登録済みの値を折り返しただけの項目(`existing_canonical`)は
 *   今回の調査で確かめていないため「登録済み」とする
 * - confirmed に `caution` / `ai` の注記が付いていれば「注記あり」とする
 *   (例: 「情報源間で電話番号の末尾表記に不一致があります」が付いた確認済みの電話番号)
 */
export function deriveItemTrust(
  item: Pick<ResearchItem, "status" | "evidence_basis" | "warning">,
): ItemTrust | null {
  switch (item.status) {
    case "inferred":
      return "inferred";
    case "conflict":
      return "conflict";
    case "confirmed": {
      if (item.evidence_basis === "existing_canonical") return "registered";
      const hasCaution = parseItemNotes(item.warning).some(
        (note) => note.kind === "caution" || note.kind === "ai",
      );
      return hasCaution ? "noted" : "confirmed";
    }
    default:
      return null;
  }
}
