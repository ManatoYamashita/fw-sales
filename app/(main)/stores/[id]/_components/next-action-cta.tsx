import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils/cn";
import {
  RESEARCH_PHASE_META,
  type ResearchPhase,
} from "@/lib/domain/store-research-phase";

/**
 * 調査フェーズに対応する「今やるべき唯一のアクション」を単一 CTA として描画する。
 *
 * Button は asChild 非対応のため、`buttonVariants` を適用した `Link` でリンクボタン化する。
 */
export function NextActionCta({
  phase,
  storeId,
}: {
  phase: ResearchPhase;
  storeId: string;
}) {
  const { cta } = RESEARCH_PHASE_META[phase];
  return (
    <div className="flex flex-col gap-1">
      <Link
        href={cta.href(storeId)}
        className={cn(buttonVariants({ variant: cta.variant, size: "sm" }), "w-fit")}
      >
        {cta.label}
        <ArrowRight className="h-3.5 w-3.5" />
      </Link>
      {cta.hint ? (
        <p className="text-xs text-muted-foreground">{cta.hint}</p>
      ) : null}
    </div>
  );
}
