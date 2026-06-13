import { Card } from "@/components/ui/card";
import { Text } from "@/components/ui/typography";
import { getGemUrlCached } from "@/lib/queries/app-settings";
import { GemUrlForm } from "./gem-url-form";

/**
 * 調査用 Gem (Gemini GUI) の URL 設定カード (store-flow-guidance / Issue #122)
 *
 * 調査ワークベンチの STEP0「Gem を開く」が開く URL を設定する。`getGemUrlCached`
 * (`'use cache'`、cookies 非依存) で現値を読み、client フォームで保存する。
 */
export async function GemUrlCard() {
  const gemUrl = await getGemUrlCached();

  return (
    <Card>
      <Card.Header>
        <Card.Title>調査用 Gem の URL</Card.Title>
      </Card.Header>
      <Card.Body className="space-y-3">
        <Text variant="muted" className="text-sm leading-relaxed">
          調査ワークベンチの「Gem を開く」が開く Gemini GUI の Gem URL です。チーム共通の
          1 本を設定します。
        </Text>
        <GemUrlForm initialUrl={gemUrl} />
      </Card.Body>
    </Card>
  );
}
