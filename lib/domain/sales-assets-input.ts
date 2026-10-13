/**
 * 営業資産生成 (`generateSalesAssetsAction`) の入力上限。
 *
 * action (`"use server"` ファイルは非同期関数しか export できない) と生成 UI の両方が
 * 同じ値を使うため、ここに置く。UI の `maxLength` と action のクリップがずれると、
 * 入力できたのに黙って切られる文字が生まれる。
 */

/**
 * 補足情報 (外部調査テキストの貼り付けを含む) の上限。生成プロンプトでは
 * 「調査結果テキスト(一次情報)」の Part として構造化せずに渡る (#121)。
 */
export const MAX_SUPPLEMENT_LENGTH = 50_000;

/** 生成への追加指示の上限。プロンプトでは「ユーザー追加指示」の Part として渡る。 */
export const MAX_INSTRUCTIONS_LENGTH = 500;
