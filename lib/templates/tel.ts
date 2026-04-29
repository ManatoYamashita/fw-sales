import type { Store } from "@/types/store";
import type { Research } from "@/types/research";

export function generateTelScript(
  store: Store,
  research: Research | null,
): string {
  const hook =
    research?.sales_hook ||
    "WEB上での集客改善でお役に立てると思いご連絡しました。";

  return `【架電スクリプト】

▼ 切り出し
「${store.name}さんでしょうか?
突然お電話失礼いたします。
Firstwebという飲食店向けのWEB集客支援をしております佐藤と申します。
1〜2分だけよろしいでしょうか?」

▼ OK の場合
「${store.name}さんのお店について、ネット上での情報を拝見しました。
${hook}

Googleマップのお問い合わせや来店数を増やすお手伝いをしているのですが、
現在、集客でお困りなことはありますか?」

▼ 反応がある場合
「ありがとうございます。一度、詳しくお話させていただけますか?
オンラインでも対面でも対応しています。
来週あたりでご都合の良いお時間はありますか?」

▼ 断られた場合
「承知しました。また機会がありましたらよろしくお願いします。
もしWEB集客でお困りのことがあればいつでもご連絡ください。」`;
}
