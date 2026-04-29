import { Badge } from "@/components/ui/badge";
import { csvToList } from "@/lib/utils/format";

export function ServiceTagList({ services }: { services: string }) {
  const list = csvToList(services);
  if (list.length === 0)
    return <span className="text-xs text-slate-400">—</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {list.map((s) => (
        <Badge key={s} tone="purple">
          {s}
        </Badge>
      ))}
    </div>
  );
}
