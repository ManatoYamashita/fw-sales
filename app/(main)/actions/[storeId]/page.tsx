import { notFound } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";
import { Mail, Phone, Lightbulb, ThumbsUp, Wrench } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScriptCard } from "./_components/script-card";
import { ActionRecordForm } from "./_components/action-record-form";
import { ChannelBadge } from "@/components/feature/channel-badge";
import { StageBadge } from "@/components/feature/stage-badge";
import { getStoreCached } from "@/lib/queries/stores";
import { getResearchByStore } from "@/lib/queries/research";
import { generateDmText } from "@/lib/templates/dm";
import { generateTelScript } from "@/lib/templates/tel";

type Params = Promise<{ storeId: string }>;

export async function generateMetadata({
  params,
}: {
  params: Params;
}): Promise<Metadata> {
  const { storeId } = await params;
  const store = await getStoreCached(storeId);
  return { title: store ? `${store.name} のアクション` : "営業アクション" };
}

export default async function ActionDetailPage({
  params,
}: {
  params: Params;
}) {
  const { storeId } = await params;
  const [store, research] = await Promise.all([
    getStoreCached(storeId),
    getResearchByStore(storeId),
  ]);
  if (!store) notFound();

  const isDM = store.channel === "DM推奨";
  const dmText = generateDmText(store, research);
  const telScript = generateTelScript(store, research);

  const strengths = research
    ? [research.strength1, research.strength2, research.strength3].filter(Boolean)
    : [];
  const weaknesses = research
    ? [research.weakness1, research.weakness2, research.weakness3].filter(Boolean)
    : [];

  return (
    <div className="space-y-4 max-w-5xl mx-auto">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <Link
            href="/actions"
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            ← アクション一覧
          </Link>
          <h2 className="text-xl md:text-2xl font-bold text-foreground mt-1">
            {store.name}
          </h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            {[store.prefecture, store.city, store.genre]
              .filter(Boolean)
              .join(" / ")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <StageBadge stage={store.stage} />
          <ChannelBadge channel={store.channel} />
        </div>
      </div>

      {!research ? (
        <Card>
          <Card.Body className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-amber-700">
                先に調査を完了してください
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                S/W分析・営業フックがあると DM/Tel スクリプトの精度が上がります。
              </p>
            </div>
            <Link
              href={`/research/${store.id}`}
              className="inline-flex h-9 px-3 rounded-md bg-primary text-primary-foreground text-sm items-center"
            >
              調査を開始
            </Link>
          </Card.Body>
        </Card>
      ) : null}

      {research ? (
        <Card>
          <Card.Header>
            <Card.Title className="inline-flex items-center gap-2">
              <Lightbulb className="h-4 w-4 text-amber-600" /> 営業メモ(攻め方)
            </Card.Title>
          </Card.Header>
          <Card.Body className="space-y-4">
            {research.sales_hook ? (
              <div className="p-3 rounded-md bg-amber-50 border border-amber-200 text-sm text-amber-900">
                <strong>刺さる一言:</strong> {research.sales_hook}
              </div>
            ) : null}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="rounded-md border border-green-200 bg-green-50 p-3">
                <p className="text-xs font-semibold text-green-700 inline-flex items-center gap-1">
                  <ThumbsUp className="h-3.5 w-3.5" /> 強み(活かす)
                </p>
                <ul className="mt-2 space-y-1 text-sm text-green-900">
                  {strengths.length === 0 ? (
                    <li className="text-muted-foreground/70">—</li>
                  ) : (
                    strengths.map((s, i) => <li key={i}>・{s}</li>)
                  )}
                </ul>
              </div>
              <div className="rounded-md border border-blue-200 bg-blue-50 p-3">
                <p className="text-xs font-semibold text-blue-700 inline-flex items-center gap-1">
                  <Wrench className="h-3.5 w-3.5" /> 弱み(改善提案)
                </p>
                <ul className="mt-2 space-y-1 text-sm text-blue-900">
                  {weaknesses.length === 0 ? (
                    <li className="text-muted-foreground/70">—</li>
                  ) : (
                    weaknesses.map((w, i) => <li key={i}>・{w}</li>)
                  )}
                </ul>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <Badge tone="purple">入口: {research.entry_product || "—"}</Badge>
              <Badge tone="slate">本命: {research.main_product || "—"}</Badge>
            </div>
          </Card.Body>
        </Card>
      ) : null}

      {isDM ? (
        <ScriptCard
          title="DM文面(フォーム送信用)"
          icon={<Mail className="h-4 w-4" />}
          text={dmText}
        />
      ) : (
        <ScriptCard
          title="テレアポ台本"
          icon={<Phone className="h-4 w-4" />}
          text={telScript}
        />
      )}

      <ActionRecordForm storeId={store.id} />
    </div>
  );
}
