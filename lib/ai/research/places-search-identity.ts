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
 * | 手動登録 | 自由入力 | 自由入力 | 自由入力 |
 *
 * したがって `${prefecture}${city}${address}` の素朴連結は、URLインポート由来の
 * 店舗で確実に `千葉県柏市千葉県柏市旭町1-1-12` を生成する。同様に `city` 側が
 * 既に都道府県を含むデータでは `埼玉県埼玉県所沢市...` になる。
 *
 * ## 規則(この順に評価する)
 *
 * 1. 全入力を `trim`。空白のみは空として扱う
 * 2. `city` が `prefecture` で始まるなら `prefecture` を前置しない
 * 3. `address` が空なら「`prefecture` + `city`」を返す
 * 4. `address` が `prefecture` で始まるなら `address` をそのまま返す(フル住所)
 * 5. `address` が `city` で始まるなら「`prefecture` + `address`」を返す
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

  // city が既に prefecture を含むなら二重付与しない。
  // prefecture が空文字の場合 `startsWith("")` は常に true になるため、
  // 自然に「city のみ」へ落ちる(特別扱い不要)。
  const areaPrefix = city === "" ? prefecture : city.startsWith(prefecture) ? city : `${prefecture}${city}`;

  if (address === "") return areaPrefix;
  if (prefecture !== "" && address.startsWith(prefecture)) return address;
  if (city !== "" && address.startsWith(city)) return `${prefecture}${address}`;
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
