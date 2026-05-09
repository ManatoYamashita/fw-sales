import { Card } from "@/components/ui/card";
import { StarRating } from "@/components/ui/star-rating";
import { ChannelBadge } from "@/components/feature/channel-badge";
import { PriorityBadge } from "@/components/feature/priority-badge";
import { ServiceTagList } from "@/components/feature/service-tag-list";
import { formatDate } from "@/lib/utils/date";
import type { Store } from "@/types/store";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="text-sm text-foreground">{children}</dd>
    </div>
  );
}

export function BasicInfoCard({ store }: { store: Store }) {
  return (
    <Card>
      <Card.Header>
        <Card.Title>基本情報</Card.Title>
      </Card.Header>
      <Card.Body>
        <dl className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Row label="エリア">
            {[store.prefecture, store.city].filter(Boolean).join(" / ") || "—"}
          </Row>
          <Row label="住所・最寄り">{store.address || "—"}</Row>
          <Row label="業態">{store.genre || "—"}</Row>
          <Row label="優先度">
            <PriorityBadge priority={store.priority} />
          </Row>
          <Row label="想定チャネル">
            <ChannelBadge channel={store.channel} />
          </Row>
          <Row label="問い合わせフォーム">{store.has_contact_form}</Row>
          <Row label="口コミ">
            {store.review_count > 0 ? (
              <span className="inline-flex items-center gap-2">
                <StarRating value={store.review_avg} showValue />
                <span className="text-xs text-muted-foreground">
                  {store.review_count} 件
                </span>
              </span>
            ) : (
              "—"
            )}
          </Row>
          <Row label="想定提案商材">
            <ServiceTagList services={store.target_service} />
          </Row>
          <Row label="運営者種別">
            {store.operator_type !== "未設定"
              ? store.operator_type
              : <span className="text-muted-foreground">—</span>}
          </Row>
          <Row label="運営者名">{store.operator_name || "—"}</Row>
          <Row label="プランナー">{store.assigned_planner || "—"}</Row>
          <Row label="営業担当">{store.assigned_sales || "—"}</Row>
          <Row label="登録日">{formatDate(store.created_at)}</Row>
          <Row label="最終更新">{formatDate(store.updated_at)}</Row>
        </dl>
      </Card.Body>
    </Card>
  );
}
