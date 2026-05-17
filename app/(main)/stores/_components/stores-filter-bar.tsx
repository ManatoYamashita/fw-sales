"use client";

import { useRouter, useSearchParams } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type ChangeEvent,
  type ReactNode,
} from "react";
import {
  ArrowDownAZ,
  ArrowUpAZ,
  Check,
  ChevronDown,
  ListFilter,
  Loader2,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils/cn";
import { STAGES, type StageId } from "@/types/stage";
import {
  CHANNELS,
  DEFAULT_STORE_SORT,
  PRIORITIES,
  SORT_KEYS,
  SORT_OPTIONS,
  type Channel,
  type Priority,
  type SortDirection,
  type StoreSortKey,
} from "@/types/store";

/* ------------------------------------------------------------------ */
/*  小さなポップオーバー (依存ゼロの軽量実装)                          */
/* ------------------------------------------------------------------ */

interface PopoverProps {
  open: boolean;
  onClose: () => void;
  /** 親要素 (relative ラッパ) を渡す。outside-click 判定に使用 */
  anchorRef: React.RefObject<HTMLElement | null>;
  align?: "start" | "end";
  className?: string;
  children: ReactNode;
}

function Popover({
  open,
  onClose,
  anchorRef,
  align = "end",
  className,
  children,
}: PopoverProps) {
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent) => {
      const root = anchorRef.current;
      if (!root) return;
      if (e.target instanceof Node && root.contains(e.target)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("mousedown", onPointer);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onPointer);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose, anchorRef]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      className={cn(
        "absolute z-40 mt-2 min-w-[260px] rounded-xl border border-border bg-popover text-popover-foreground shadow-popover",
        "animate-slide-up origin-top",
        align === "end" ? "right-0" : "left-0",
        className,
      )}
    >
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Filter Bar 本体                                                     */
/* ------------------------------------------------------------------ */

const ALL_FILTER_KEYS = ["q", "stage", "channel", "priority"] as const;
type FilterKey = (typeof ALL_FILTER_KEYS)[number];

export function StoresFilterBar() {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  /* --- 現在の状態 --- */
  const q = params.get("q") ?? "";
  const stage = (params.get("stage") ?? "") as StageId | "";
  const channel = (params.get("channel") ?? "") as Channel | "";
  const priority = (params.get("priority") ?? "") as Priority | "";
  const sortKey: StoreSortKey =
    (SORT_KEYS as readonly string[]).includes(params.get("sort") ?? "")
      ? (params.get("sort") as StoreSortKey)
      : DEFAULT_STORE_SORT.key;
  const sortDir: SortDirection =
    params.get("dir") === "asc" ? "asc" : "desc";

  const filterCount = useMemo(
    () =>
      [stage, channel, priority].filter(Boolean).length, // 検索語(q) は別カウント
    [stage, channel, priority],
  );
  const sortDefault = sortKey === DEFAULT_STORE_SORT.key && sortDir === DEFAULT_STORE_SORT.dir;

  /* --- URL 反映 --- */
  const push = useCallback(
    (mutate: (next: URLSearchParams) => void) => {
      const next = new URLSearchParams(params.toString());
      mutate(next);
      startTransition(() => {
        const qs = next.toString();
        router.replace(qs ? `/stores?${qs}` : "/stores");
      });
    },
    [params, router],
  );

  const setKey = (key: FilterKey | "sort" | "dir", value: string) =>
    push((next) => {
      if (value) next.set(key, value);
      else next.delete(key);
    });

  const clearAll = () =>
    push((next) => {
      ALL_FILTER_KEYS.forEach((k) => next.delete(k));
      next.delete("sort");
      next.delete("dir");
    });
  const clearFilters = () =>
    push((next) => {
      ALL_FILTER_KEYS.forEach((k) => next.delete(k));
    });

  /* --- 入力検索 (debounce) --- */
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onSearch = (e: ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setKey("q", v), 220);
  };
  const clearSearch = () => setKey("q", "");

  /* --- ポップオーバー制御 --- */
  const filterAnchor = useRef<HTMLDivElement>(null);
  const sortAnchor = useRef<HTMLDivElement>(null);
  const [openFilter, setOpenFilter] = useState(false);
  const [openSort, setOpenSort] = useState(false);

  const hasAnyFilter = filterCount > 0 || q.length > 0;
  const hasAny = hasAnyFilter || !sortDefault;

  /* --- 並び替えラベル --- */
  const sortMeta = SORT_OPTIONS.find((o) => o.key === sortKey)!;
  const sortLabel = `${sortMeta.label} · ${
    sortDir === "asc" ? sortMeta.ascLabel : sortMeta.descLabel
  }`;

  return (
    <div
      className={cn(
        "rounded-xl border border-border bg-card shadow-card",
        "transition-shadow",
      )}
    >
      {/* === コマンドバー本体 === */}
      <div className="flex items-stretch flex-wrap gap-2 p-2">
        {/* 検索 (主役) */}
        <div className="relative flex-1 min-w-[180px] basis-full sm:basis-auto">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            key={q /* URL からの値同期用 */}
            defaultValue={q}
            onChange={onSearch}
            placeholder="店舗名・エリア・業態・メモから検索…"
            aria-label="店舗を検索"
            className={cn(
              "h-11 pl-10 pr-10 text-[15px] tracking-tight",
              "border-transparent bg-muted/50 hover:bg-muted/70 focus-visible:bg-background",
              "shadow-none rounded-lg",
            )}
          />
          {q ? (
            <button
              type="button"
              onClick={clearSearch}
              aria-label="検索語をクリア"
              className="absolute right-2 top-1/2 -translate-y-1/2 h-7 w-7 inline-flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>

        {/* 縦区切り */}
        <span aria-hidden className="hidden sm:block w-px self-stretch my-1 bg-border" />

        {/* 絞り込みトリガー */}
        <div ref={filterAnchor} className="relative">
          <TriggerButton
            onClick={() => {
              setOpenSort(false);
              setOpenFilter((v) => !v);
            }}
            active={filterCount > 0}
            aria-expanded={openFilter}
            aria-haspopup="dialog"
            icon={<SlidersHorizontal className="h-4 w-4" />}
            badge={filterCount > 0 ? filterCount : undefined}
          >
            絞り込み
          </TriggerButton>

          <Popover
            open={openFilter}
            onClose={() => setOpenFilter(false)}
            anchorRef={filterAnchor}
            className="w-[min(92vw,360px)]"
          >
            <FilterPanel
              stage={stage}
              channel={channel}
              priority={priority}
              onChangeStage={(v) => setKey("stage", v)}
              onChangeChannel={(v) => setKey("channel", v)}
              onChangePriority={(v) => setKey("priority", v)}
              onClear={clearFilters}
              activeCount={filterCount}
            />
          </Popover>
        </div>

        {/* 並び替えトリガー */}
        <div ref={sortAnchor} className="relative">
          <TriggerButton
            onClick={() => {
              setOpenFilter(false);
              setOpenSort((v) => !v);
            }}
            active={!sortDefault}
            aria-expanded={openSort}
            aria-haspopup="dialog"
            icon={
              sortDir === "asc" ? (
                <ArrowUpAZ className="h-4 w-4" />
              ) : (
                <ArrowDownAZ className="h-4 w-4" />
              )
            }
            trailing={<ChevronDown className="h-3.5 w-3.5 opacity-60" />}
          >
            <span className="hidden md:inline">{sortMeta.label}</span>
            <span className="md:hidden">並び替え</span>
          </TriggerButton>

          <Popover
            open={openSort}
            onClose={() => setOpenSort(false)}
            anchorRef={sortAnchor}
            className="w-[min(92vw,300px)]"
          >
            <SortPanel
              sortKey={sortKey}
              sortDir={sortDir}
              onChange={(k, d) => {
                push((next) => {
                  if (k === DEFAULT_STORE_SORT.key && d === DEFAULT_STORE_SORT.dir) {
                    next.delete("sort");
                    next.delete("dir");
                  } else {
                    next.set("sort", k);
                    next.set("dir", d);
                  }
                });
              }}
            />
          </Popover>
        </div>
      </div>

      {/* === アクティブ状態行 (ピル) === */}
      {hasAny ? (
        <div className="flex items-center gap-2 flex-wrap border-t border-border/80 px-3 py-2.5 bg-muted/30 rounded-b-xl">
          <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
            <ListFilter className="h-3 w-3" /> 適用中
          </span>

          {q ? (
            <Chip onClear={clearSearch} label="検索">
              「{q}」
            </Chip>
          ) : null}
          {stage ? (
            <Chip onClear={() => setKey("stage", "")} label="ステージ">
              {stage}
            </Chip>
          ) : null}
          {channel ? (
            <Chip onClear={() => setKey("channel", "")} label="チャネル">
              {channel}
            </Chip>
          ) : null}
          {priority ? (
            <Chip onClear={() => setKey("priority", "")} label="優先度">
              {priority}
            </Chip>
          ) : null}
          {!sortDefault ? (
            <Chip
              onClear={() =>
                push((next) => {
                  next.delete("sort");
                  next.delete("dir");
                })
              }
              label="並び順"
              tone="muted"
            >
              {sortLabel}
            </Chip>
          ) : null}

          <div className="flex-1" />

          {pending ? (
            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" /> 適用中…
            </span>
          ) : null}

          <Button
            variant="ghost"
            size="sm"
            onClick={clearAll}
            className="text-xs h-7 px-2"
          >
            すべて解除
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  サブコンポーネント                                                   */
/* ------------------------------------------------------------------ */

interface TriggerButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean;
  icon?: ReactNode;
  trailing?: ReactNode;
  badge?: number;
}

function TriggerButton({
  active,
  icon,
  trailing,
  badge,
  className,
  children,
  ...props
}: TriggerButtonProps) {
  return (
    <button
      type="button"
      className={cn(
        "inline-flex h-11 items-center gap-1.5 rounded-lg px-3 text-sm font-medium",
        "border border-transparent transition-[background-color,border-color,box-shadow]",
        "hover:bg-accent text-foreground/80 hover:text-foreground",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active &&
          "bg-foreground text-background border-foreground hover:bg-foreground/90 hover:text-background",
        className,
      )}
      {...props}
    >
      {icon}
      <span>{children}</span>
      {typeof badge === "number" ? (
        <span
          aria-label={`${badge}件のフィルタ適用中`}
          className={cn(
            "ml-0.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-semibold tabular-nums",
            active
              ? "bg-background text-foreground"
              : "bg-foreground text-background",
          )}
        >
          {badge}
        </span>
      ) : null}
      {trailing}
    </button>
  );
}

interface ChipProps {
  label: string;
  onClear: () => void;
  tone?: "default" | "muted";
  children: ReactNode;
}

function Chip({ label, onClear, children, tone = "default" }: ChipProps) {
  return (
    <span
      className={cn(
        "group inline-flex items-center gap-1.5 h-7 pl-2 pr-1 rounded-full border text-xs",
        tone === "default"
          ? "border-border bg-background"
          : "border-border/70 bg-card",
      )}
    >
      <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
        {label}
      </span>
      <span className="font-medium text-foreground truncate max-w-[160px]">
        {children}
      </span>
      <button
        type="button"
        onClick={onClear}
        aria-label={`${label}フィルタを解除`}
        className="inline-flex h-5 w-5 items-center justify-center rounded-full text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
      >
        <X className="h-3 w-3" />
      </button>
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  フィルタパネル (Popover 中身)                                        */
/* ------------------------------------------------------------------ */

interface FilterPanelProps {
  stage: StageId | "";
  channel: Channel | "";
  priority: Priority | "";
  onChangeStage: (v: string) => void;
  onChangeChannel: (v: string) => void;
  onChangePriority: (v: string) => void;
  onClear: () => void;
  activeCount: number;
}

function FilterPanel({
  stage,
  channel,
  priority,
  onChangeStage,
  onChangeChannel,
  onChangePriority,
  onClear,
  activeCount,
}: FilterPanelProps) {
  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-border">
        <h3 className="text-sm font-semibold tracking-tight">絞り込み条件</h3>
        {activeCount > 0 ? (
          <button
            type="button"
            onClick={onClear}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            リセット
          </button>
        ) : null}
      </div>

      <div className="px-4 py-3 space-y-4 max-h-[60vh] overflow-y-auto">
        <PanelGroup label="ステージ">
          <ChipGroup
            value={stage}
            onChange={onChangeStage}
            options={STAGES.map((s) => ({ value: s.id, label: s.label }))}
            stage
          />
        </PanelGroup>

        <PanelGroup label="チャネル">
          <ChipGroup
            value={channel}
            onChange={onChangeChannel}
            options={CHANNELS.map((c) => ({ value: c, label: c }))}
          />
        </PanelGroup>

        <PanelGroup label="優先度">
          <ChipGroup
            value={priority}
            onChange={onChangePriority}
            options={PRIORITIES.map((p) => ({ value: p, label: p }))}
          />
        </PanelGroup>
      </div>
    </div>
  );
}

function PanelGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground mb-2">
        {label}
      </div>
      {children}
    </div>
  );
}

interface ChipGroupProps {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  /** ステージ用に data-stage を付与し、配色変数を当てる */
  stage?: boolean;
}

function ChipGroup({ value, onChange, options, stage }: ChipGroupProps) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((opt) => {
        const selected = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(selected ? "" : opt.value)}
            data-stage={stage ? opt.value : undefined}
            className={cn(
              "inline-flex items-center gap-1 h-7 px-2.5 rounded-full text-xs font-medium",
              "border transition-[background-color,color,border-color]",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              selected
                ? "bg-foreground text-background border-foreground"
                : stage
                  ? "border-transparent bg-stage text-stage-foreground hover:brightness-95"
                  : "border-border bg-background text-foreground/80 hover:bg-accent",
            )}
          >
            {selected ? <Check className="h-3 w-3" /> : null}
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  ソートパネル                                                         */
/* ------------------------------------------------------------------ */

interface SortPanelProps {
  sortKey: StoreSortKey;
  sortDir: SortDirection;
  onChange: (key: StoreSortKey, dir: SortDirection) => void;
}

function SortPanel({ sortKey, sortDir, onChange }: SortPanelProps) {
  return (
    <div className="flex flex-col">
      <div className="px-4 py-3 border-b border-border">
        <h3 className="text-sm font-semibold tracking-tight">並び替え</h3>
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          項目をクリックして適用、もう一度押すと方向を反転
        </p>
      </div>

      <ul role="radiogroup" className="py-1.5">
        {SORT_OPTIONS.map((opt) => {
          const selected = sortKey === opt.key;
          const effectiveDir = selected ? sortDir : opt.defaultDir;
          const directionLabel =
            effectiveDir === "asc" ? opt.ascLabel : opt.descLabel;

          return (
            <li key={opt.key}>
              <button
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => {
                  if (selected) {
                    onChange(opt.key, sortDir === "asc" ? "desc" : "asc");
                  } else {
                    onChange(opt.key, opt.defaultDir);
                  }
                }}
                className={cn(
                  "group w-full flex items-center justify-between gap-3 px-4 py-2.5 text-left text-sm",
                  "transition-colors hover:bg-accent",
                  selected && "bg-accent/60",
                )}
              >
                <span className="flex items-center gap-2.5 min-w-0">
                  <span
                    className={cn(
                      "inline-flex h-5 w-5 items-center justify-center rounded-full border",
                      selected
                        ? "border-foreground bg-foreground text-background"
                        : "border-border text-transparent group-hover:border-foreground/40",
                    )}
                  >
                    <Check className="h-3 w-3" />
                  </span>
                  <span className="font-medium text-foreground">{opt.label}</span>
                </span>

                <span
                  className={cn(
                    "inline-flex items-center gap-1 text-xs",
                    selected
                      ? "text-foreground"
                      : "text-muted-foreground",
                  )}
                >
                  {effectiveDir === "asc" ? (
                    <ArrowUpAZ className="h-3.5 w-3.5" />
                  ) : (
                    <ArrowDownAZ className="h-3.5 w-3.5" />
                  )}
                  {directionLabel}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
