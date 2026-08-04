/**
 * 店舗名・住所・電話番号のnormalize/matchロジック(fix/ai-research-final-audit-hardening
 * で導入、fix/ai-research-source-identity-integrity でPlaces専用モジュールから
 * `lib/ai/research/places-stage0.ts`と`pipeline.ts`(Stage2 source_verifications照合)の
 * 共通モジュールへ切り出した)。
 *
 * 実機smokeで、Stage2のper-source identity verification(`source_verifications`)が
 * モデル自己申告の`relation:"target_store"`をそのまま信用してよいか判定する際、
 * Google Places Text Search fallback(`places-stage0.ts`)と全く同じ「店名・住所・
 * 電話番号の表記ゆれを吸収した一致判定」が必要になったため、実装を重複させず
 * 1箇所に集約する。
 */

import "server-only";

import { normalizeFormattedAddress } from "@/lib/places/to-store-input";

/**
 * 店舗名先頭の営業管理タグ(例:「（Rアポハマロスト）」「（7月1日NEW）」等、表記統一されない
 * 自由記述の営業ステータスメモ)を除去し、実店舗名相当の文字列を返す
 * (feat/ai-research-quality-refinement)。
 *
 * fw-salesの実データ調査により、営業管理タグは常に店舗名の**先頭**に括弧で囲まれる形で
 * 追加されることを確認した(例:「（Rアポハマロスト）炉端ジュン」→実店舗名は
 * 「炉端ジュン」)。一方、フリガナ等の正当な括弧表記(例:「川端 （かわばた）」)は
 * 名前の途中・末尾に現れるため、先頭の括弧グループのみを除去対象とすることで
 * 誤って正当な店名表記を壊さない。除去後に空文字になる場合(異常系)は
 * rawをそのまま返す(検索クエリが空になることを避ける)。
 */
const LEADING_MANAGEMENT_TAG_RE = /^[（(]([^（）()]*)[）)]\s*(.+)$/;

export function deriveSearchIdentityName(rawName: string): string {
  const match = rawName.match(LEADING_MANAGEMENT_TAG_RE);
  const remainder = match?.[2]?.trim();
  return remainder && remainder !== "" ? remainder : rawName.trim();
}

function normalizeForNameMatch(s: string): string {
  return s.normalize("NFKC").replace(/\s+/g, "").toLowerCase();
}

/**
 * 正規化後の完全一致、またはどちらかがもう一方を含む場合にマッチとみなす
 * (Google Places/Web上の表記(例:「東北メシ 炉端ジュン」)とfw-sales内の実店舗名
 * (例:「炉端ジュン」)の表記ゆれを許容するため)。ただし名前一致のみでは
 * 採用しない(呼び出し側が住所or電話の一致を別途必須とする)。
 * 極端に短い名前(2文字未満)での誤マッチを防ぐため、包含判定には長さ下限を設ける。
 */
export function isNameMatch(placeName: string, searchIdentityName: string): boolean {
  const a = normalizeForNameMatch(placeName);
  const b = normalizeForNameMatch(searchIdentityName);
  if (!a || !b) return false;
  if (a === b) return true;
  if (b.length < 2) return false;
  return a.includes(b) || b.includes(a);
}

/**
 * ハイフン様Unicode文字(全角ハイフン・各種ダッシュ・MINUS SIGN等)をASCIIハイフンへ
 * 統一する(feat/ai-research-final-trust-boundary)。
 *
 * 実際のGoogle Places Text Search応答を実APIで確認した結果、Google側の住所区切り文字が
 * `U+2212`(MINUS SIGN、数学記号)であり、`NFKC`正規化では変換されない
 * (`NFKC`が変換するのは全角ハイフン`U+FF0D`等の互換分解対象のみで、`U+2212`は対象外)
 * ことが判明した。この結果、`NFKC`だけでは正規化後も
 * `候補側:"...1-1−12..."`(末尾がU+2212混入)と`店舗側:"...1-1-12..."`(全てASCII)が
 * 一致しなかった(実データで確認済み、以前の実装ではここが原因で住所不一致になっていた)。
 */
function unifyDashLikeChars(raw: string): string {
  return raw.replace(/[‐‑‒–—−－]/g, "-");
}

/**
 * 日本住所の最小限の表記ゆれ吸収(feat/ai-research-searchfact-places-match、
 * feat/ai-research-final-trust-boundaryでダッシュ文字統一を追加)。
 *
 * 実際のGoogle Places候補データで検証済み: Google側`formattedAddress`
 * (例:「日本、〒277-0852 千葉県柏市旭町１丁目１−１２」全角数字・「丁目」表記・
 * MINUS SIGN区切り)と fw-sales側`stores.address`
 * (例:「〒2770852 千葉県 柏市 旭町1-1-12」半角ハイフン区切り)は、以下を行わない限り
 * 単純な部分一致では一致しない:
 * 1. `normalizeFormattedAddress`(既存、`lib/places/to-store-input.ts`)で
 *    先頭の「日本、」・郵便番号prefixを除去
 * 2. `NFKC`正規化で全角数字を半角化
 * 3. ハイフン様Unicode文字(`unifyDashLikeChars`)をASCIIハイフンへ統一
 * 4. 空白除去
 * 5. 「丁目」「番地」「番」「号」をハイフンへ統一(住所の意味的同一性推定等の
 *    過剰な曖昧化はしない、表記統一のみ)
 *
 * `normalizeFormattedAddress`は元々Google Places応答向けだが、Web検索結果ページの
 * 住所表記も同種の表記ゆれ(全角数字・「丁目」表記等)を持つため、Stage2の
 * `observed_address`照合にも安全に転用できる。
 */
export function normalizeJapaneseAddressForMatch(raw: string): string {
  return unifyDashLikeChars(normalizeFormattedAddress(raw).normalize("NFKC"))
    .replace(/\s+/g, "")
    .replace(/[丁目番地号]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * 番地・号相当の具体的な数字-数字パターン(例: "1-2-3"の一部)を含むか判定する
 * (feat/ai-research-final-audit-hardening、監査で発見)。
 *
 * `isAddressMatch`の包含判定(`a.includes(b) || b.includes(a)`)は、`isNameMatch`の
 * 短い名前ガード(`b.length < 2`)に相当する下限が無かった。市区町村・町丁目までしか
 * 無い短い住所文字列は、同じ町丁目内の別の建物のformattedAddressにも常に包含されて
 * しまい、`isNameMatch`(こちらも同名チェーン等で緩い)と組み合わさると別の場所を
 * 誤ってstrong matchとして採用しうる。番地相当の数字-数字パターンを両者に要求する
 * ことで、町丁目レベルの過剰マッチを防ぐ(`isNameMatch`と同じ「最小限の具体性」
 * ガードの考え方)。
 */
function hasBanchiLevelSpecificity(normalized: string): boolean {
  return /\d+-\d+/.test(normalized);
}

export function isAddressMatch(placeAddress: string, storeAddress: string): boolean {
  const a = normalizeJapaneseAddressForMatch(placeAddress);
  const b = normalizeJapaneseAddressForMatch(storeAddress);
  if (!a || !b) return false;
  if (a === b) return true;
  if (!hasBanchiLevelSpecificity(a) || !hasBanchiLevelSpecificity(b)) return false;
  return a.includes(b) || b.includes(a);
}

export function normalizePhone(phone: string): string {
  return phone.replace(/[^\d]/g, "");
}

/**
 * 「店舗名一致 AND (住所一致 OR 電話一致)」の strong match 判定
 * (fix/ai-research-source-identity-integrity、FIX3)。
 *
 * `places-stage0.ts:findStrongMatches`と同じ判定基準を、Stage2の
 * `source_verifications`(モデルがURL本文から実際に観測した`observed_name`/
 * `observed_address`/`observed_phone`)とStoreIdentityの照合にも使う。
 * ページに住所・電話が無く名前だけの場合はfalseを返す
 * (false positiveよりfalse negativeを優先、名前一致だけでは信用しない)。
 */
export function isTargetStoreMatch(
  observed: { name: string | null; address: string | null; phone: string | null },
  target: { name: string; address: string; phone: string },
): boolean {
  if (!observed.name || observed.name.trim() === "") return false;
  const targetIdentityName = deriveSearchIdentityName(target.name);
  if (!isNameMatch(observed.name, targetIdentityName)) return false;

  const addressMatches =
    !!observed.address &&
    observed.address.trim() !== "" &&
    target.address.trim() !== "" &&
    isAddressMatch(observed.address, target.address);
  const phoneMatches =
    !!observed.phone &&
    observed.phone.trim() !== "" &&
    target.phone.trim() !== "" &&
    normalizePhone(observed.phone) === normalizePhone(target.phone);

  return addressMatches || phoneMatches;
}
