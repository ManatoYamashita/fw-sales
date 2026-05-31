/**
 * AI 分析の標準（組み込み）プロンプトテンプレート定義。
 *
 * - templateId 未指定時のフォールバック (`lib/ai/prompt.ts`)
 * - 設定画面の閲覧専用一覧表示
 * で共通参照する単一ソース。
 *
 * 出典: GitHub Issue #13 ユーザー提供サンプル (導楽 / 蕎楽亭)
 */

import type { FewShotExample, TemplateBody } from "@/types/ai-prompt-template";

export const BUILTIN_PROMPT_TEMPLATE_ID = "__builtin__";

export const BUILTIN_PROMPT_TEMPLATE_NAME = "標準テンプレート";

/** 標準テンプレートの Few-shot 例 2 件。 */
export const BUILTIN_FEWSHOT_EXAMPLES: readonly FewShotExample[] = [
  {
    title: "居酒屋・海鮮",
    store_meta:
      "食べログ URL https://s.tabelog.com/kanagawa/A1405/A140504/14096697/ (居酒屋・神奈川県川崎市・刺身/日本酒)",
    call_script_ideal: `ご準備中にすみません
私ファーストWEBの{ASSIGNED_SALES}と申しまして

神奈川県川崎市の海鮮や日本酒がいただける居酒屋さん中心にWEBでのご情報発信をお手伝いさせていただいてるのですが、
お手すきであればご代表のオーナー様お願いしたかったのですが〜

(オーナー変わる)
ご準備中すみません
私ファーストWEBの{ASSIGNED_SALES}と申しまして

神奈川県川崎市の海鮮や日本酒がいただける居酒屋さん中心にWEBでのご情報発信をお手伝いさせていただいてるのですが、昨日実際にお食事いただきまして、刺し盛に新鮮なくじらのお刺身が入っていたり、日本酒の種類もかなり多く取り揃えられていて本当に美味しかったのでお電話取らさせていただいたのですが、

よくあるグルメサイト等のご案内ではないんですが、お店の公式の情報を正しく発信することに加えてそれらを包括的にGoogleに認知させるためのお手伝いをしているので

まずは一度弊社の取り組み内容のご説明のご機会をいただきたく事前にお電話取らせていただたんですけれども
ちなみにオーナーさんの方で普段こういうお話だったり業者のご対応にあてられるお時間帯で言うと、比較的14時〜16時ぐらいがご迷惑少ないでしょうか?`,
  },
  {
    title: "蕎麦・郷土料理",
    store_meta:
      "食べログ URL https://s.tabelog.com/tokyo/A1309/A130905/13000479/ (蕎麦・東京都・会津郷土料理)",
    call_script_ideal: `ランチ終わりにすみません
私ファーストWEBの{ASSIGNED_SALES}と申しまして

Googleマップ含めたWEBでのご情報発信をお手伝いさせていただいてるのですが、
お手すきであればご代表のオーナー様お願いしたかったのですが〜

(オーナー変わる)
ご準備中すみません
私ファーストWEBの{ASSIGNED_SALES}と申しまして

Googleマップ含めたWEBでのご情報発信をお手伝いさせていただいてるのですが、
都内のお蕎麦屋さんの中でも、こづゆや馬刺しなどの会津の郷土料理が楽しめると情報拝見してとても気になりお電話取らさせていただいたのですが、

よくあるグルメサイト等のご案内ではないんですが、お店の公式の情報として正しく認知してもらうことに加えてそれらを包括的にGoogleに認知させるためのお手伝いをしているので

まずは一度弊社の取り組み内容のご説明のご機会をいただきたく事前にお電話取らせていただたんですけれども
ちなみにオーナーさんの方で普段こういうお話だったり業者のご対応にあてられるお時間帯で言うと、比較的14時〜16時ぐらいがご迷惑少ないでしょうか?

ヒアリング〜
常連さんの特徴?`,
  },
] as const;

export function getBuiltinTemplateBody(): TemplateBody {
  return {
    kind: "fewshots",
    fewshots: [...BUILTIN_FEWSHOT_EXAMPLES],
  };
}
