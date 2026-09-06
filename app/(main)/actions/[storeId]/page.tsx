import { notFound } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";
import { Mail, Phone } from "lucide-react";
import { ScriptCard } from "./_components/script-card";
import { ActionRecordForm } from "./_components/action-record-form";
import { ChannelBadge } from "@/components/feature/channel-badge";
import { StageBadge } from "@/components/feature/stage-badge";
import { getStoreCached } from "@/lib/queries/stores";
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
  const store = await getStoreCached(storeId);
  if (!store) notFound();

  const isDM = store.channel === "DM推奨";
  // Issue #110: 旧 research テーブル (手入力の S/W 分析・営業フック) を撤去したため、
  // スクリプトは店舗情報のみから生成する。調査結果に基づく強み / 弱み / 架電台本は
  // AI 店舗調査 (`/research/[storeId]`) と営業資産生成 (`/stores/[id]` の AI 分析タブ)
  // が担当する。
  const dmText = generateDmText(store);
  const telScript = generateTelScript(store);

  return (
    <div className="space-y-4 max-w-5xl mx-auto">
      <div className="flex items-start justify-between gap-3 flex-wrap [&>*+*]:ml-auto">
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
