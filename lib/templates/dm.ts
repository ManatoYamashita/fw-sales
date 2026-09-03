import type { Store } from "@/types/store";

/**
 * DM フォーム送信用の定型文を組み立てる。
 *
 * Issue #110 で旧 `research` テーブル (手入力の口コミ要約・営業フック) を撤去したため、
 * 店舗情報のみから生成する定型文になっている。調査結果を織り込んだ文面が必要な場合は
 * AI 店舗調査 + 営業資産生成 (`generateSalesAssetsAction`) を使うこと。
 */
export function generateDmText(store: Store): string {
  return `突然のご連絡失礼いたします。
Firstwebと申します。

${store.name}さんのお店について、
ネット上での情報を拝見させていただきました。

一方で、WEB上での情報発信を強化することで、新規のお客様をさらに増やせるポテンシャルを感じています。

弊社は個人飲食店様向けのWEB集客支援を専門としており、
・Googleマップ上位表示(MEO対策)
・ホームページ制作・運用
・Instagram運用支援
などをご提供しています。

まずは無料でヒアリングさせていただければと思いますが、
ご都合はいかがでしょうか?

どうぞよろしくお願いいたします。

Firstweb 佐藤`;
}
