import type { Store } from "@/types/store";
import type { Research } from "@/types/research";

export function generateDmText(store: Store, research: Research | null): string {
  const positiveTop =
    research?.review_positive?.split(/[、,]/)?.[0]?.trim() ?? "";
  const hook =
    research?.sales_hook ||
    "一方で、WEB上での情報発信を強化することで、新規のお客様をさらに増やせるポテンシャルを感じています。";

  return `突然のご連絡失礼いたします。
Firstwebと申します。

${store.name}さんのお店について、
ネット上での情報を拝見させていただきました。

${positiveTop ? `お客様の口コミを拝見すると、「${positiveTop}」など、大変高い評価をいただいているようです。\n` : ""}${hook}

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
