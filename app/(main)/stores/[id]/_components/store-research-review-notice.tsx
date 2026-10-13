import Link from "next/link";
import { StoreResearchStatusBadge } from "@/components/feature/stage-badge";
import { RESEARCH_REVIEW_PENDING } from "@/lib/domain/store-research-status";
import { storeNeedsResearchReview } from "@/lib/queries/research";

/**
 * 未レビューの AI 調査結果があるときだけ出す案内 (#299)。
 *
 * `/stores` の調査段階列と `/research` のタブは、この状態の店舗を「レビュー待ち」として
 * 扱う。店舗詳細の段階セレクトは手動で「調査済み」等にできるため、ここで同じ状態を
 * 明示しないと「一覧ではレビュー待ちなのに詳細では調査済み」と食い違って見える。
 *
 * 判定は Workflow の step が書き込む `store_research_runs` を都度読むため `'use cache'` を
 * 使わない。ページの静的シェルを崩さないよう、呼び出し側で Suspense 境界の内側に置くこと。
 */
export async function StoreResearchReviewNotice({ storeId }: { storeId: string }) {
  if (!(await storeNeedsResearchReview(storeId))) return null;
  return (
    <div
      role="note"
      aria-label="AI 調査結果のレビュー待ち"
      className="mt-3 max-w-2xl rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm"
    >
      <p className="flex flex-wrap items-center gap-2">
        <StoreResearchStatusBadge status={RESEARCH_REVIEW_PENDING} />
        <span>
          まだレビューしていない AI 調査結果があります。レビューが済むまで、調査結果は基本情報に反映されません。
        </span>
      </p>
      <Link
        href={`/research/${storeId}`}
        className="mt-2 inline-block underline underline-offset-2 hover:text-foreground"
      >
        調査結果をレビューする
      </Link>
    </div>
  );
}
