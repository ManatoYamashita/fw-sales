import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { repos } from "@/lib/repositories";
import {
  KEEPALIVE_LAST_RUN_KEY,
  KEEPALIVE_STALE_AFTER_HOURS,
  isKeepaliveStale,
} from "@/lib/domain/keepalive";
import { formatDateTime } from "@/lib/utils/date";

/**
 * Supabase keepalive の最終実行時刻カード (Issue #242)。
 *
 * `app/api/cron/keepalive/route.ts` が Vercel Cron から書いた記録を読む。
 * Vercel の Runtime Logs は Hobby プランでは 1 時間しか残らないため、
 * 「cron が本当に DB へ届いているか」を人が後から確かめられる唯一の窓口になる。
 *
 * これは **表示であって検知器ではない**。誰も画面を見ない期間こそが危険な期間
 * (GitHub の 60 日 auto-disable が発火するのはまさにその期間) なので、
 * 実際に異常を人へ push する役目は GitHub Actions 版 keepalive の赤に負わせる。
 *
 * `repos.appSettings.get` は PK 一致の 1 行 SELECT で `use cache` を被せる価値が
 * 無く、そもそも鮮度を映すカードをキャッシュするのは自己矛盾なので、素の IO を
 * 呼び出し側 (settings/page.tsx) の <Suspense> で隔離して dynamic hole にする
 * (UserManagementCard / AiPromptTemplatesCard と同型)。
 */
export async function KeepaliveStatusCard() {
  const lastRun = await repos.appSettings.get(KEEPALIVE_LAST_RUN_KEY);
  const stale = isKeepaliveStale(lastRun);

  return (
    <Card>
      <Card.Header>
        <Card.Title>Supabase keepalive</Card.Title>
      </Card.Header>
      <Card.Body className="space-y-2 text-sm text-muted-foreground leading-relaxed">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge tone={stale ? "warning" : "success"}>
            {stale ? "要確認" : "正常"}
          </Badge>
          <span className="text-foreground">
            最終実行: {lastRun ? formatDateTime(lastRun) : "記録なし"}
          </span>
        </div>
        <p>
          本番 DB は無操作が 7 日続くと自動停止するため、Vercel Cron と GitHub
          Actions が毎日アクセスして停止を防いでいます。
        </p>
        {stale ? (
          <p className="text-warning">
            {KEEPALIVE_STALE_AFTER_HOURS}
            時間以上更新されていません。Vercel の Cron Jobs 設定と GitHub Actions
            の Supabase Keepalive が有効か確認してください。
          </p>
        ) : null}
      </Card.Body>
    </Card>
  );
}
