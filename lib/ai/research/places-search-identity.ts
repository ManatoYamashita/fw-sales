/**
 * Stage0 Google Places 専用の identity 構築(PR #180 pre-merge fix:
 * Stage0 Places Identity Recovery)。
 *
 * ## 何を直すか
 *
 * `loadStoreStep`(`workflows/store-research.ts`)は Stage0 へ
 * `{ name, address, phone }` しか渡しておらず、`stores.prefecture` /
 * `stores.city` を**完全に捨てていた**。その結果、
 *
 * ```
 * store.address === "" かつ store.phone === ""
 * ```
 *
 * の店舗では
 *
 * 1. `searchPlaces(name, address)` の `textQuery` が店舗名だけに退化し、
 *    全国の同名候補が返る(`lib/places/google.ts` の
 *    `textQuery = [keyword, area].filter(Boolean).join(" ")`)
 * 2. `findStrongMatches`(`places-stage0.ts`)の2つのゲートが
 *    `store.address.trim() !== ""` / `normalizePhone(store.phone) !== ""` で
 *    **両方とも構造的に false** になる
 *
 * ため strong match が 0 件になり、`places_search_no_match` として
 * Places 応答が丸ごと破棄されていた。`rating` / `userRatingCount` は
 * `SEARCH_FIELD_MASK` で既に取得できているのに、`review_avg` / `review_count` が
 * `not_found` へ退化する(実機事象: 告膳)。
 *
 * これは match 条件が厳しすぎる問題ではなく、**既に DB にある具体的 identity が
 * match 処理へ届いていない data plumbing bug** である。
 *
 * ## なぜ `StoreIdentity` と別の型にするのか
 *
 * `StoreIdentity`(`lib/ai/research/prompts.ts`)は現在3つの役割を兼ねている:
 *
 * 1. Stage0 Places の検索クエリ + strong match 入力
 * 2. Stage1 / Stage2 prompt の「対象店舗」ブロック
 * 3. `applySourceIdentityVerification` / `isTargetStoreMatch` の target
 *
 * PR #180 には accepted limitation として F1(Stage2 が target identity を見た上で
 * observed page identity を自己申告する)が残っている。`StoreIdentity` へ
 * 情報を足すと (2)(3) も同時に richer になり、モデルが observed_* を target へ
 * 寄せて報告した場合の検出力が下がる = F1 を悪化させる。
 *
 * そこで **Stage0 専用**の `PlacesSearchIdentity` を分離する。本型は `genre` を
 * 持たないため `StoreIdentity` へ構造的に代入できず、Stage1 / Stage2 /
 * `applySourceIdentityVerification` へ誤って渡すと**コンパイルエラーになる**。
 * これが F1 を悪化させないことのコンパイル時保証である。
 *
 * ## やらないこと
 *
 * - `basic_info` を identity source にしない。`basic_info` には過去の AI 調査結果を
 *   Human Review で採用した値も `filled_by: "manual"` として存在しうるため、
 *   `AI-derived identity → Places strong match → deterministic confirmed` という
 *   弱い循環が生じる。
 * - 住所の推測・補完をしない。郵便番号の付与、番地の推定、都道府県の推測はしない。
 *   行うのは**既存文字列の結合と重複回避のみ**。
 * - strong match の不変条件(`name match AND (address match OR phone match)`、
 *   かつ候補が一意)を1行も緩めない。`isNameMatch` / `isAddressMatch` /
 *   `hasBanchiLevelSpecificity` / `normalizePhone` / `pickStrongPlaceMatch` は無改変。
 *   市区町村までしか住所が無ければ従来どおり `no_match` でよい。
 */

import { normalizeFormattedAddress } from "@/lib/places/to-store-input";

/** Stage0 Google Places 専用の店舗 identity。`StoreIdentity` とは別物(上記 JSDoc 参照)。 */
export interface PlacesSearchIdentity {
  name: string;
  address: string;
  phone: string;
}

/** `buildBestStoreAddress` / `buildPlacesSearchIdentity` が必要とする `Store` の部分集合。 */
export interface StoreAddressParts {
  prefecture: string;
  city: string;
  address: string;
}

/**
 * `stores` の `prefecture` / `city` / `address` から、Places 検索と住所照合に使える
 * 最も具体的な住所文字列を組み立てる。
 *
 * ## なぜ素朴な連結ではいけないか
 *
 * この repo では3列の意味論が**登録経路ごとに割れている**:
 *
 * | 登録経路 | prefecture | city | address |
 * | --- | --- | --- | --- |
 * | エリア検索(`lib/places/to-store-input.ts`) | `千葉県` | `柏市` | **残差** `旭町1-1-12` |
 * | URLインポート(`lib/url-parser/places-fallback.ts`) | `千葉県` | `柏市` | **フル住所** `千葉県柏市旭町1-1-12` |
 * | 手動登録・一括インポート | 自由入力 | **営業テリトリー名でありうる** | **`〒` 始まりフル住所** |
 *
 * したがって `${prefecture}${city}${address}` の素朴連結は、URLインポート由来の
 * 店舗で確実に `千葉県柏市千葉県柏市旭町1-1-12` を生成する。同様に `city` 側が
 * 既に都道府県を含むデータでは `埼玉県埼玉県所沢市...` になる。
 *
 * ## `〒` 始まりの住所と、行政区名でない `city`(2026-08-15 実測)
 *
 * 本番の全店舗を調べたところ、**8割強**の `address` が
 * `〒2770852 千葉県 柏市 旭町1-1-12` の形(郵便番号 + スペース区切りのフル住所)で、
 * さらに **3割強**の `city` に行政区名ではなく営業テリトリー名
 * (`柏市・我孫子市` のように複数市区を並べた担当範囲。実際の所在地とは別)が
 * 入っていた。手動登録・一括インポート経路では `city` が「担当エリア」の意味で
 * 使われることがあり、住所として信用できない。
 *
 * 当初の実装は重複回避を `address.startsWith(prefecture)` で判定していたため、
 * `〒` 始まりの住所では**常に false** になり、無条件で areaPrefix を前置していた:
 *
 * ```
 * 千葉県柏市・我孫子市〒2770852 千葉県 柏市 旭町1-1-12   ← テリトリー名が混入
 * 千葉県〒2770852 千葉県 柏市 旭町1-1-12                 ← 都道府県が重複
 * ```
 *
 * そこで判定用の probe 文字列を `normalizeFormattedAddress`
 * (`lib/places/to-store-input.ts`、`〒` prefix 除去を既に持つ)で作り、それに対して
 * 判定する。**戻り値は元の `address` 文字列のまま**返す(probe は判定にのみ使う)。
 * `〒` が Places の `textQuery` に含まれていても害は無く、住所照合側は
 * `normalizeJapaneseAddressForMatch` が同じ prefix を剥がすため。
 *
 * ## 規則(この順に評価する)
 *
 * 1. 全入力を `trim`。空白のみは空として扱う。判定用に
 *    `probe = normalizeFormattedAddress(address)` を作る
 * 2. `city` が `prefecture` で始まるなら `prefecture` を前置しない
 * 3. `address` が空なら「`prefecture` + `city`」を返す
 * 4. `probe` が `prefecture` を**含む**なら `address` をそのまま返す(フル住所)。
 *    `startsWith` ではなく `includes` にするのは、`〒` 除去後も先頭が都道府県とは
 *    限らない(`日本、` 等の残りうるノイズ)ため
 * 5. `probe` が `city` で始まるなら「`prefecture` + `address`」を返す
 * 6. それ以外は「`prefecture` + `city` + `address`」を返す(残差)
 *
 * 市区町村までしか情報が無い場合も合成結果を返す(空文字へ倒さない)。番地が無いことに
 * よる strong match 不成立は `identity-match.ts:hasBanchiLevelSpecificity` が
 * 従来どおり担保するため、ここで捨てると Places の `textQuery` から市区町村が消えて
 * 候補の質だけが下がる。
 */
export function buildBestStoreAddress(parts: StoreAddressParts): string {
  const prefecture = parts.prefecture.trim();
  const city = parts.city.trim();
  const address = parts.address.trim();

  // 判定にだけ使う正規化済み住所。`〒2770852 ` / `日本、` といった prefix を落とし、
  // 「この住所は既に都道府県・市区町村を含んでいるか」を素の文字列で判定できるようにする。
  // 戻り値には使わない(上の JSDoc「〒 始まりの住所」節を参照)。
  const probe = normalizeFormattedAddress(address);

  // city が既に prefecture を含むなら二重付与しない。
  // prefecture が空文字の場合 `startsWith("")` は常に true になるため、
  // 自然に「city のみ」へ落ちる(特別扱い不要)。
  const areaPrefix = city === "" ? prefecture : city.startsWith(prefecture) ? city : `${prefecture}${city}`;

  if (address === "") return areaPrefix;
  if (prefecture !== "" && probe.includes(prefecture)) return address;
  if (city !== "" && probe.startsWith(city)) return `${prefecture}${address}`;
  return `${areaPrefix}${address}`;
}

/**
 * `stores` のスカラー列だけから Stage0 専用 identity を組み立てる。
 *
 * `name` / `phone` はスカラー列をそのまま使う:
 *
 * - `name` は Places の検索キーワードそのものであり、差し替えると全店舗の検索結果が
 *   変わる(最大の回帰リスク源)。`deriveSearchIdentityName` による営業管理タグ除去は
 *   従来どおり `places-stage0.ts` 側で行う。
 * - `phone` は `normalizePhone` が数字以外を除去するため、「不明」等の非番号値は
 *   正規化後に空になり、従来どおり電話一致が成立しない。
 *
 * `address` のみ `buildBestStoreAddress` で合成する(この関数の唯一の目的)。
 */
export function buildPlacesSearchIdentity(
  store: StoreAddressParts & { name: string; phone: string },
): PlacesSearchIdentity {
  return {
    name: store.name,
    address: buildBestStoreAddress(store),
    phone: store.phone,
  };
}
