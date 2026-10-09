import Link from "next/link";
import { ArrowRight, FileText } from "lucide-react";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { buttonVariants } from "@/components/ui/button";
import { CopyButton } from "@/components/feature/copy-button";
import { cn } from "@/lib/utils/cn";
import { SALES_ASSET_FIELDS } from "@/lib/domain/sales-asset-fields";
import { salesAssetsHref } from "@/lib/domain/store-research-phase";
import type { Store } from "@/types/store";

/**
 * 店舗詳細「AI 分析」タブ。営業資産を**閲覧・コピーするだけ**の面 (Issue #300)。
 *
 * #300 以前はここにも生成 UI (Gemini 手動貼付の欄つき `SalesAssetsGenerator`) があり、
 * `/research/[storeId]` の生成セクションと入口が二重になっていた。生成・編集は
 * `/research/[storeId]` の ③ に集約し、ここからはそこへ遷移させる。
 */
export function SalesAssetsSummary({ store }: { store: Store }) {
  const result = store.ai_analysis_result;

  if (!result) {
    return (
      <EmptyState
        icon={<FileText aria-hidden />}
        title="営業資産はまだありません"
        description="AI調査 → レビュー → 営業資産の生成の順に進めると、強み・弱み・架電スクリプトがここに表示されます。"
        action={
          <Link
            href={`/research/${store.id}`}
            className={buttonVariants({ variant: "primary", size: "sm" })}
          >
            AI調査から始める
            <ArrowRight className="h-3.5 w-3.5" aria-hidden />
          </Link>
        }
      />
    );
  }

  return (
    <Card>
      <Card.Header>
        <Card.Title>営業資産</Card.Title>
        <Link
          href={salesAssetsHref(store.id)}
          className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
        >
          編集・再生成
          <ArrowRight className="h-3.5 w-3.5" aria-hidden />
        </Link>
      </Card.Header>
      <Card.Body className="flex flex-col gap-5">
        {SALES_ASSET_FIELDS.map((f) => (
          <section key={f.key} aria-labelledby={`sales-asset-${f.key}`} className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between gap-2">
              <h3 id={`sales-asset-${f.key}`} className="text-sm font-medium text-foreground">
                {f.label}
              </h3>
              {result[f.key].trim() !== "" && <CopyButton text={result[f.key]} target={f.label} />}
            </div>
            {result[f.key].trim() !== "" ? (
              <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground">
                {result[f.key]}
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">(内容なし)</p>
            )}
          </section>
        ))}
        <p className="text-xs text-muted-foreground">
          編集・再生成は調査ページの「③ 営業資産を生成」で行います。
        </p>
      </Card.Body>
    </Card>
  );
}
