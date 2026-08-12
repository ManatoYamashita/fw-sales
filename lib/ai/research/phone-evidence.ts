/**
 * `phone` 項目の evidence 裏付け検証(PR #180 final smoke hardening、Issue B)。
 *
 * ## 背景
 *
 * 食べログ等には「店舗直通番号」と「予約・問い合わせ用の 050 番号」が併記される。
 * 両方が営業上有用なため、`phone` は役割ラベル付きで**複数番号を保持できる**ようにした
 * (`prompts.ts:PHONE_ROLE_INSTRUCTION`)。
 *
 * ## この関数が守る不変条件
 *
 * 番号を複数書けるようにすると、モデルが**実在しない番号を生成**するリスクが増える。
 * そこで「`value` に書かれた全ての番号が `evidence` にも現れていること」を
 * deterministic に要求する。既存の trust boundary(url_context 成功 + identity
 * target_match + source_ids 一致)は `validateResearchItemStatus` が引き続き担い、
 * 本関数はそこに**番号そのものの裏付け**を1段足す。
 *
 * ## この検証の trust level(正確な説明)
 *
 * これは **AI 自己整合性チェック**であって、**source 本文の deterministic 照合ではない**。
 * URL Context は取得したページ本文をアプリコードへ返さない
 * (`@google/genai` の `UrlContextMetadata` は `urlMetadata[].retrievedUrl` と
 * `urlRetrievalStatus` のみ。`GroundingChunkWeb` も `{domain,title,uri}` のみで
 * snippet を含まない)。したがってモデルが `value` と `evidence` の**両方**へ
 * 同じ hallucinated 番号を書いた場合、本関数では検出できない。
 *
 * source 側の信頼性は引き続き `validateResearchItemStatus` が担う
 * (url_context 成功 + identity `target_match` + `source_ids` 一致 + 非competitor)。
 * 本関数はそこへ「番号が evidence と整合している」ことを1段足すものである。
 *
 * ## 適用範囲(AI 生成経路のみ)
 *
 * Stage2 prompt に「value に書いた番号は evidence にも書く」を明示したため、
 * **単一番号にも同じ要件を課す**。電話番号は誤りのコストが特に高い
 * (営業担当が誤った番号へ架電する)ため単一番号を例外にしない。
 * ただし `evidence_basis` が `places` / `existing_canonical` の item は
 * evidence がコード側の定型文なので対象外にする(既存経路を退化させない)。
 *
 * ## 比較規則
 *
 * 数字以外を除去した文字列で比較する(`identity-match.ts:normalizePhone` と同じ規則)。
 * ハイフン・括弧・空白といった**表記差だけを同一視**し、**別番号は同一視しない**。
 */

import { normalizePhone } from "./identity-match";
import type { ResearchItem, ResearchItemCandidate } from "@/lib/ai/research-result-schema";

/** 日本の電話番号として妥当な桁数レンジ(市外局番込み)。 */
const MIN_PHONE_DIGITS = 10;
const MAX_PHONE_DIGITS = 11;

/**
 * 数字・ハイフン・括弧・空白で構成された「電話番号らしい」並びを拾うための粗い抽出。
 * 桁数チェックは `extractPhoneNumbers` 側で行う。
 */
const PHONE_LIKE_PATTERN = /[0-9][0-9\-‐-‒–—―ー()（）\s]{7,}[0-9]/g;

/**
 * 文字列から電話番号を正規化済み(数字のみ)で重複なく抽出する。
 *
 * 表記差だけを吸収するため、抽出後は `normalizePhone` と同じ「数字以外を除去」を行い、
 * 10〜11桁のものだけを電話番号として採用する(席数・日付・金額を拾わないため)。
 */
export function extractPhoneNumbers(text: string | null | undefined): string[] {
  if (typeof text !== "string" || text.trim() === "") return [];
  const found = new Set<string>();
  for (const raw of text.match(PHONE_LIKE_PATTERN) ?? []) {
    const digits = normalizePhone(raw);
    if (digits.length >= MIN_PHONE_DIGITS && digits.length <= MAX_PHONE_DIGITS) {
      found.add(digits);
    }
  }
  return [...found];
}

const UNBACKED_PHONE_WARNING =
  "value に含まれる電話番号の一部が根拠(evidence)に現れないため自動的に格下げしました。";

/**
 * `value` に書かれた全ての電話番号が `evidence` にも現れるかを判定する共通述語。
 * 番号が1件も書かれていない `value`(例:「非公開」)は対象外として `true` を返す。
 */
function areValuePhonesBackedByEvidence(
  value: string | null | undefined,
  evidence: string | null | undefined,
): boolean {
  const numbersInValue = extractPhoneNumbers(value);
  if (numbersInValue.length === 0) return true;
  const numbersInEvidence = new Set(extractPhoneNumbers(evidence));
  return numbersInValue.every((number) => numbersInEvidence.has(number));
}

/**
 * AI が生成したものではない経路の `evidence_basis`。
 *
 * - `places`: Stage0 が Google Places から取得し、コード側が合成した item
 * - `existing_canonical`: 登録済み `basic_info` からの fallback item
 *
 * どちらも `evidence` は**コード側の定型文**であり数字を含まない。
 * AI 向けの evidence 要件を掛けると既に動いている経路を退化させるため対象外にする。
 */
const NON_AI_EVIDENCE_BASES: ReadonlySet<string> = new Set(["places", "existing_canonical"]);

/**
 * `phone` の `value` に含まれる全ての番号が `evidence` にも現れることを要求する。
 *
 * 満たさない場合は `not_found` へ降格し `value` を null にする
 * (false positive より false negative を優先する既存方針に合わせる)。
 *
 * ## 適用対象
 *
 * `key === "phone"` かつ `status === "confirmed"` かつ **AI 生成経路**
 * (`evidence_basis` が `places` / `existing_canonical` **以外**)。
 * 番号が1件でも適用する: Stage2 prompt が「value に書いた番号は evidence にも書く」ことを
 * 明示要求するようになったため、単一番号にも同じ要件を課せる。電話番号は誤りのコストが
 * 特に高い(営業担当が誤った番号へ架電する)ため、単一番号を例外にしない。
 *
 * ## この検証で言えること / 言えないこと
 *
 * **言えること**: `value` と `evidence` が互いに整合していること(AI 自己整合性)。
 * **言えないこと**: その番号が実際の source 本文に存在すること。
 * URL Context は取得したページ本文をアプリコードへ返さない
 * (`UrlContextMetadata` は `retrievedUrl` / `urlRetrievalStatus` のみ)ため、
 * deterministic な本文照合は現アーキテクチャでは不可能である。
 * source 側の信頼性は引き続き `validateResearchItemStatus`
 * (url_context 成功 + identity target_match + source_ids 一致)が担う。
 *
 * 純関数。入力を変更せず、変更が無ければ**同一参照**を返す。
 */
export function enforcePhoneNumbersBackedByEvidence(item: ResearchItem): ResearchItem {
  if (item.key !== "phone" || item.status !== "confirmed") return item;
  if (item.evidence_basis != null && NON_AI_EVIDENCE_BASES.has(item.evidence_basis)) return item;

  if (areValuePhonesBackedByEvidence(item.value, item.evidence)) return item;

  return {
    ...item,
    status: "not_found",
    value: null,
    confidence: null,
    candidates: undefined,
    warning: item.warning ? `${UNBACKED_PHONE_WARNING} ${item.warning}` : UNBACKED_PHONE_WARNING,
  };
}

/**
 * conflict の1 candidate について、`candidate.value` の全番号が `candidate.evidence` にも
 * 現れるかを判定する(PR #180 final smoke hardening、BLOCKER 2)。
 *
 * `research-result-schema.ts:ResearchValidationContext.conflictCandidateEvidenceGuard`
 * へ渡す実装。`false` を返した candidate は trusted candidate として扱われず、
 * conflict の選択肢から除外される。
 *
 * ## なぜ conflict にも必要か
 *
 * `enforcePhoneNumbersBackedByEvidence` は `status === "confirmed"` のみを対象とするため、
 * `status === "conflict"` の candidate には一切効かない。conflict の候補は
 * そのままユーザーへ選択肢として提示され、採用されれば canonical `basic_info` へ入る。
 * 「confirmed だけ番号裏付けを要求し、conflict candidate は素通り」という非対称は
 * 誤った番号がむしろ通りやすい経路になるため、同じ要件を課す。
 *
 * ## この検証の trust level(confirmed 側と同じ限界)
 *
 * これは **AI 自己整合性チェック**であり、**source 本文の deterministic 照合ではない**。
 * URL Context は取得したページ本文をアプリコードへ返さない(`UrlContextMetadata` は
 * `retrievedUrl` / `urlRetrievalStatus` のみ)ため、モデルが `value` と `evidence` の
 * 両方へ同じ hallucinated 番号を書いた場合は検出できない。source 側の信頼性は
 * `research-result-schema.ts:isVerifiedSourceForItem`(url_context 成功 + identity
 * target_match + 非competitor)が独立に担い、本関数はそこへ1段足すものである。
 *
 * ## 適用範囲
 *
 * `item.key === "phone"` のみ。それ以外の key には現状ルールが無いため常に `true` を返す
 * (この関数はすべての key に対して呼ばれる汎用 guard として使われる)。
 * `evidence_basis` が `places` / `existing_canonical` の item は evidence がコード側の
 * 定型文なので対象外にする(`enforcePhoneNumbersBackedByEvidence` と同じ判断)。
 *
 * 純関数。
 */
export function isConflictCandidateEvidenceBacked(
  item: ResearchItem,
  candidate: ResearchItemCandidate,
): boolean {
  if (item.key !== "phone") return true;
  if (item.evidence_basis != null && NON_AI_EVIDENCE_BASES.has(item.evidence_basis)) return true;
  return areValuePhonesBackedByEvidence(candidate.value, candidate.evidence);
}
