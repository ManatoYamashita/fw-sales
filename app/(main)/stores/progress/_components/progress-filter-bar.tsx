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
  Check,
  ListFilter,
  Loader2,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils/cn";
import { DEAL_STATUSES } from "@/types/deal";
import { STAGES } from "@/types/stage";
import { CHANNELS } from "@/types/store";
import {
  CURRENT_SALES_STATES,
  CURRENT_SALES_STATE_LABELS,
  NEXT_ACTION_URGENCIES,
  NEXT_ACTION_URGENCY_LABELS,
} from "@/lib/domain/sales-progress";
import {
  SALES_SENTINEL_VALUES,
  type SalesSentinel,
} from "../../_components/store-quick-filter-params";

/* ------------------------------------------------------------------ */
/*  小さなポップオーバー (stores-filter-bar.tsx と同じ依存ゼロ実装)      */
/* ------------------------------------------------------------------ */

interface PopoverProps {
  open: boolean;
  onClose: () => void;
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

const ALL_FILTER_KEYS = ["q", "state", "appt", "deal", "next", "sales", "stage", "channel"] as const;
type FilterKey = (typeof ALL_FILTER_KEYS)[number];

const APPT_OPTIONS = [
  { value: "acquired", label: "取得済み" },
  { value: "none", label: "未取得" },
] as const;

const DEAL_OPTIONS = [
  ...DEAL_STATUSES.map((s) => ({ value: s, label: s })),
  { value: "none", label: "営業記録なし" },
];

const NEXT_OPTIONS = NEXT_ACTION_URGENCIES.map((u) => ({
  value: u,
  label: NEXT_ACTION_URGENCY_LABELS[u],
}));

/**
 * `sales` sentinel の詳細フィルタ上の表示名。
 *
 * 値そのものは `store-quick-filter-params.ts` が単一の真実で、ここは表示名だけを持つ。
 * `Record<SalesSentinel, string>` なので sentinel を増やすとラベル漏れが型エラーになる。
 * クイックフィルタ側の「自分の担当 / 未担当」より短いのは、この Select が
 * 「営業担当」という文脈の中に置かれるため (営業担当: 自分)。
 */
const SALES_SENTINEL_LABELS: Record<SalesSentinel, string> = {
  me: "自分",
  none: "未割当",
};

/**
 * 営業担当 Select の選択肢を組み立てる。
 *
 * 「すべての担当」→ sentinel (自分 / 未割当) → 実担当者 の順。
 * **適用中チップの表示にも同じ配列を使う**ことで、Select に一致する option が無いのに
 * チップだけ何かを表示している、という食い違いを構造的に起こせなくする。
 * `me` の UUID 解決はサーバ (`stores-table.tsx`) の責務なので、ここでは表示名だけ扱う。
 */
export function buildSalesOptions(
  profileEntries: ReadonlyArray<readonly [string, string]>,
): ReadonlyArray<{ value: string; label: string }> {
  return [
    { value: "", label: "すべての担当" },
    ...SALES_SENTINEL_VALUES.map((value) => ({
      value,
      label: SALES_SENTINEL_LABELS[value],
    })),
    ...profileEntries.map(([id, name]) => ({ value: id, label: name })),
  ];
}

export interface ProgressFilterBarProps {
  /** `Profile.id → display_name` の tuple 配列 (RSC 境界用)。 */
  profileEntries: ReadonlyArray<readonly [string, string]>;
}

export function ProgressFilterBar({ profileEntries }: ProgressFilterBarProps) {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  /* --- 現在の状態 --- */
  const q = params.get("q") ?? "";
  const appt = params.get("appt") ?? "";
  const deal = params.get("deal") ?? "";
  const next = params.get("next") ?? "";
  const sales = params.get("sales") ?? "";
  const state = params.get("state") ?? "";
  const stage = params.get("stage") ?? "";
  const channel = params.get("channel") ?? "";

  const salesOptions = useMemo(
    () => buildSalesOptions(profileEntries),
    [profileEntries],
  );

  const filterCount = useMemo(
    () => [state, appt, deal, next, sales, stage, channel].filter(Boolean).length,
    [state, appt, deal, next, sales, stage, channel],
  );

  /* --- URL 反映 --- */
  const push = useCallback(
    (mutate: (nextParams: URLSearchParams) => void) => {
      const nextParams = new URLSearchParams(params.toString());
      mutate(nextParams);
      startTransition(() => {
        const qs = nextParams.toString();
        router.replace(qs ? `/stores?${qs}` : "/stores");
      });
    },
    [params, router],
  );

  const setKey = (key: FilterKey, value: string) =>
    push((nextParams) => {
      if (value) nextParams.set(key, value);
      else nextParams.delete(key);
    });

  /* --- 入力検索 (debounce) --- */
  /**
   * 入力値はローカル state を単一の真実とし、URL の `q` は「確定値」として扱う。
   *
   * 以前は `<Input key={q} defaultValue={q}>` で URL 同期していたが、debounce 自身が
   * push した URL 変更でも key が変わって `<input>` が再マウントされ、フォーカスと
   * caret が飛び、push 〜 commit の間に打った文字が defaultValue で上書き消失していた。
   * pushedTermRef に「自分が push した値」を記録し、それと異なる q (ブラウザの戻る /
   * 進む、外部からのクリア) が来たときだけ入力値を URL へ追従させる。
   */
  const [term, setTerm] = useState(q);
  const pushedTermRef = useRef(q);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (q === pushedTermRef.current) return;
    pushedTermRef.current = q;
    setTerm(q);
  }, [q]);

  // アンマウント後に router.replace が発火するのを防ぐ
  useEffect(
    () => () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    },
    [],
  );

  /** 保留中の debounce を捨てて入力値を空へ戻す (クリア系ボタン共通)。 */
  const resetSearchTerm = () => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    pushedTermRef.current = "";
    setTerm("");
  };

  const onSearch = (e: ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    setTerm(v);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      pushedTermRef.current = v;
      setKey("q", v);
    }, 220);
  };
  const clearSearch = () => {
    resetSearchTerm();
    setKey("q", "");
  };

  const clearAll = () => {
    resetSearchTerm();
    push((nextParams) => {
      ALL_FILTER_KEYS.forEach((k) => nextParams.delete(k));
      nextParams.delete("sort");
      nextParams.delete("dir");
    });
  };
  const clearFilters = () => {
    resetSearchTerm();
    push((nextParams) => {
      ALL_FILTER_KEYS.forEach((k) => nextParams.delete(k));
    });
  };

  /* --- ポップオーバー制御 --- */
  const filterAnchor = useRef<HTMLDivElement>(null);
  const [openFilter, setOpenFilter] = useState(false);

  const hasAnyFilter = filterCount > 0 || q.length > 0;

  const labelOf = (options: ReadonlyArray<{ value: string; label: string }>, value: string) =>
    options.find((o) => o.value === value)?.label ?? value;

  return (
    <div className="rounded-xl border border-border bg-card shadow-card transition-shadow">
      {/* === コマンドバー本体 === */}
      <div className="flex items-stretch flex-wrap gap-2 p-2">
        {/* 検索 (主役) */}
        <div className="relative flex-1 min-w-[180px] basis-full sm:basis-auto">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={term}
            onChange={onSearch}
            placeholder="店舗名・最寄駅・次回アクションから検索…"
            aria-label="顧客を検索"
            className={cn(
              "h-11 pl-10 pr-10 text-[15px] tracking-tight",
              "border-transparent bg-muted/50 hover:bg-muted/70 focus-visible:bg-background",
              "shadow-none rounded-lg",
            )}
          />
          {term ? (
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
            onClick={() => setOpenFilter((v) => !v)}
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
              state={state}
              appt={appt}
              deal={deal}
              next={next}
              sales={sales}
              stage={stage}
              channel={channel}
              salesOptions={salesOptions}
              onChange={setKey}
              onClear={clearFilters}
              activeCount={filterCount}
            />
          </Popover>
        </div>
      </div>

      {/* === アクティブ状態行 (ピル) === */}
      {hasAnyFilter ? (
        <div className="flex items-center gap-2 flex-wrap border-t border-border/80 px-3 py-2.5 bg-muted/30 rounded-b-xl">
          <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
            <ListFilter className="h-3 w-3" /> 適用中
          </span>

          {q ? (
            <Chip onClear={clearSearch} label="検索">
              「{q}」
            </Chip>
          ) : null}
          {state ? (
            <Chip onClear={() => setKey("state", "")} label="営業状態">
              {CURRENT_SALES_STATE_LABELS[state as keyof typeof CURRENT_SALES_STATE_LABELS] ?? state}
            </Chip>
          ) : null}
          {appt ? (
            <Chip onClear={() => setKey("appt", "")} label="アポ">
              {labelOf(APPT_OPTIONS, appt)}
            </Chip>
          ) : null}
          {deal ? (
            <Chip onClear={() => setKey("deal", "")} label="営業記録">
              {labelOf(DEAL_OPTIONS, deal)}
            </Chip>
          ) : null}
          {next ? (
            <Chip onClear={() => setKey("next", "")} label="次回">
              {labelOf(NEXT_OPTIONS, next)}
            </Chip>
          ) : null}
          {sales ? (
            <Chip onClear={() => setKey("sales", "")} label="担当">
              {labelOf(salesOptions, sales)}
            </Chip>
          ) : null}
          {stage ? <Chip onClear={() => setKey("stage", "")} label="調査段階">{stage}</Chip> : null}
          {channel ? <Chip onClear={() => setKey("channel", "")} label="チャネル">{channel}</Chip> : null}

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
/*  サブコンポーネント (stores-filter-bar.tsx と同型)                    */
/* ------------------------------------------------------------------ */

interface TriggerButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean;
  icon?: ReactNode;
  badge?: number;
}

function TriggerButton({
  active,
  icon,
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
    </button>
  );
}

interface ChipProps {
  label: string;
  onClear: () => void;
  children: ReactNode;
}

function Chip({ label, onClear, children }: ChipProps) {
  return (
    <span className="group inline-flex items-center gap-1.5 h-7 pl-2 pr-1 rounded-full border border-border bg-background text-xs">
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
  state: string;
  appt: string;
  deal: string;
  next: string;
  sales: string;
  stage: string;
  channel: string;
  /** `buildSalesOptions` の結果。適用中チップと同じ配列を共有する。 */
  salesOptions: ReadonlyArray<{ value: string; label: string }>;
  onChange: (key: FilterKey, value: string) => void;
  onClear: () => void;
  activeCount: number;
}

function FilterPanel({
  state,
  appt,
  deal,
  next,
  sales,
  stage,
  channel,
  salesOptions,
  onChange,
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
        <PanelGroup label="現在の営業状態">
          <Select value={state} onChange={(e) => onChange("state", e.target.value)} aria-label="現在の営業状態で絞り込み">
            <option value="">すべて</option>
            {CURRENT_SALES_STATES.map((value) => <option key={value} value={value}>{CURRENT_SALES_STATE_LABELS[value]}</option>)}
          </Select>
        </PanelGroup>
        <PanelGroup label="アポ取得">
          <ChipGroup
            value={appt}
            onChange={(v) => onChange("appt", v)}
            options={[...APPT_OPTIONS]}
          />
        </PanelGroup>

        <PanelGroup label="最新の営業状態">
          <ChipGroup
            value={deal}
            onChange={(v) => onChange("deal", v)}
            options={DEAL_OPTIONS}
          />
        </PanelGroup>

        <PanelGroup label="次回アクション">
          <ChipGroup
            value={next}
            onChange={(v) => onChange("next", v)}
            options={NEXT_OPTIONS}
          />
        </PanelGroup>

        <PanelGroup label="営業担当">
          <Select
            value={sales}
            onChange={(e) => onChange("sales", e.target.value)}
            aria-label="営業担当で絞り込み"
          >
            {salesOptions.map(({ value, label }) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </PanelGroup>
        <PanelGroup label="調査段階"><Select value={stage} onChange={(e) => onChange("stage", e.target.value)} aria-label="調査段階で絞り込み"><option value="">すべて</option>{STAGES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</Select></PanelGroup>
        <PanelGroup label="チャネル"><Select value={channel} onChange={(e) => onChange("channel", e.target.value)} aria-label="チャネルで絞り込み"><option value="">すべて</option>{CHANNELS.map((value) => <option key={value} value={value}>{value}</option>)}</Select></PanelGroup>
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
}

function ChipGroup({ value, onChange, options }: ChipGroupProps) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((opt) => {
        const selected = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(selected ? "" : opt.value)}
            className={cn(
              "inline-flex items-center gap-1 h-7 px-2.5 rounded-full text-xs font-medium",
              "border transition-[background-color,color,border-color]",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              selected
                ? "bg-foreground text-background border-foreground"
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
