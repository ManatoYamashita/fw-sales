import { Badge } from "@/components/ui/badge";
import type { DealStatus } from "@/types/deal";

/**
 * 商談ステータスの共通バッジ (customer-sales-progress-management)。
 *
 * 従来 deals 一覧 / 商談詳細で別々に定義されていたトーンマップを一本化する。
 * 保存値 (`Deal.status`) は変更せず、表示ラベルのみ「受注 = 契約中 / 失注 = ロスト」が
 * 一目で分かる補足付きにする。
 */
const STATUS_TONE: Record<
  DealStatus,
  "info" | "warning" | "success" | "destructive"
> = {
  初回接触: "info",
  アポ取得: "success",
  継続追客: "info",
  見積提出: "warning",
  受注: "success",
  失注: "destructive",
};

const STATUS_LABEL: Record<DealStatus, string> = {
  初回接触: "初回接触",
  アポ取得: "アポ取得",
  継続追客: "継続追客",
  見積提出: "見積提出",
  受注: "受注（契約）",
  失注: "失注（ロスト）",
};

export function DealStatusBadge({ status }: { status: DealStatus }) {
  return <Badge tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Badge>;
}
