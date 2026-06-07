import Link from "next/link";
import { cacheLife, cacheTag } from "next/cache";
import { Card } from "@/components/ui/card";
import { getPipelineSummary } from "@/lib/queries/pipeline";
import { CACHE_TAGS } from "@/lib/cache";

async function loadSummary() {
  "use cache";
  cacheLife("longBackstop");
  cacheTag(CACHE_TAGS.stores, CACHE_TAGS.pipeline);
  return getPipelineSummary();
}

export async function PipelineSummary() {
  const rows = await loadSummary();
  const max = Math.max(...rows.map((r) => r.count), 1);

  return (
    <Card>
      <Card.Header>
        <Card.Title>パイプライン</Card.Title>
        <Link
          href="/pipeline"
          className="text-sm font-medium text-blue-700 hover:text-blue-800"
        >
          ボードを見る →
        </Link>
      </Card.Header>
      <Card.Body>
        <ul className="space-y-2.5">
          {rows.map((row) => (
            <li
              key={row.stage}
              className="flex items-center gap-3 text-sm"
            >
              <span
                className="inline-flex items-center justify-center px-2 py-0.5 rounded-full text-xs font-medium min-w-24 text-center"
                style={{ background: row.bg, color: row.color }}
              >
                {row.label}
              </span>
              <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${(row.count / max) * 100}%`,
                    background: row.color,
                    minWidth: row.count > 0 ? "8px" : 0,
                  }}
                />
              </div>
              <span className="w-10 text-right tabular-nums text-foreground font-semibold">
                {row.count}
              </span>
            </li>
          ))}
        </ul>
      </Card.Body>
    </Card>
  );
}

export function PipelineSummarySkeleton() {
  return (
    <Card>
      <Card.Header>
        <Card.Title>パイプライン</Card.Title>
      </Card.Header>
      <Card.Body>
        <div className="h-44 bg-muted rounded animate-pulse" />
      </Card.Body>
    </Card>
  );
}
