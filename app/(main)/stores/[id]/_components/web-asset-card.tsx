import { ExternalLink, Phone } from "lucide-react";
import { Card } from "@/components/ui/card";
import type { Store } from "@/types/store";

function LinkRow({
  label,
  url,
}: {
  label: string;
  url: string;
}) {
  if (!url) {
    return (
      <li className="flex items-center justify-between gap-2 py-2 border-b border-slate-100 last:border-b-0">
        <span className="text-sm text-slate-500">{label}</span>
        <span className="text-xs text-slate-400">未設定</span>
      </li>
    );
  }
  return (
    <li className="flex items-center justify-between gap-2 py-2 border-b border-slate-100 last:border-b-0">
      <span className="text-sm text-slate-500">{label}</span>
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 text-sm text-blue-700 hover:text-blue-800 max-w-[280px] truncate"
      >
        {url} <ExternalLink className="h-3 w-3 shrink-0" />
      </a>
    </li>
  );
}

export function WebAssetCard({ store }: { store: Store }) {
  return (
    <Card>
      <Card.Header>
        <Card.Title>WEB資産・連絡先</Card.Title>
      </Card.Header>
      <Card.Body className="py-1">
        <ul>
          <LinkRow label="Googleマップ" url={store.map_url} />
          <LinkRow label="公式サイト" url={store.site_url} />
          <LinkRow label="Instagram" url={store.instagram_url} />
          <li className="flex items-center justify-between gap-2 py-2 border-b border-slate-100 last:border-b-0">
            <span className="text-sm text-slate-500">電話番号</span>
            {store.phone ? (
              <a
                href={`tel:${store.phone}`}
                className="inline-flex items-center gap-1 text-sm text-blue-700 hover:text-blue-800"
              >
                <Phone className="h-3 w-3" />
                {store.phone}
              </a>
            ) : (
              <span className="text-xs text-slate-400">未設定</span>
            )}
          </li>
        </ul>
      </Card.Body>
    </Card>
  );
}
