"use client";

import Link from "next/link";
import { ArrowLeftRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { DataTable, type ColumnDef } from "@/components/ui/data-table";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { formatDate } from "@/lib/utils/date";
import { formatYen } from "@/lib/utils/format";
import type { Handoff, HandoffStatus } from "@/types/handoff";

const statusTone: Record<HandoffStatus, "amber" | "green"> = {
  運用確認待ち: "amber",
  完了: "green",
};

/**
 * 引き継ぎ一覧の列定義 (#224 / #220 の横展開)。
 *
 * `minContainerWidth` は「その列を出すのに要るコンテナ幅 (px)」で、列単体の
 * 実測幅を優先度順に累計して決めている。この画面は grid を通らないため
 * コンテナ幅は `/stores` と同一 (341〜1710px) で、1023px 以上では全 5 列が収まる。
 *
 * 落とす順は「一覧でのトリアージに効かない列から」。この画面には**フィルタ UI が
 * 一切無い**ので、状態 (運用確認待ち / 完了) が目視スキャンの唯一のトリアージ軸に
 * なる。店舗は唯一の遷移導線。期日が第 2 の軸、運用担当は「宛先」、金額は
 * 引き継ぎ**内容**であって一覧の判断材料ではない。
 *
 * テストから配分表を固定するため export している。引数を取らないので module
 * scope で 1 度だけ評価する。
 */
export function buildColumns(): ColumnDef<Handoff>[] {
  return [
    {
      key: "store",
      header: "店舗",
      // store_name は text 列 (長さ制約なし) なので上限が無いと min-content が
      // 青天井になり、以降の列の閾値がまとめてずれる。予算 200px (cap)。
      truncate: true,
      maxWidth: "200px",
      title: (h) => h.store_name || undefined,
      cell: (h) => (
        <Link
          href={`/handoffs/${h.id}`}
          className="font-semibold text-foreground hover:text-link"
        >
          {h.store_name}
        </Link>
      ),
    },
    {
      key: "fee",
      header: "初期/月額",
      align: "right",
      // この列だけ truncate / maxWidth を付けない。金額を ellipsis で切ると
      // 「¥1,234,567 / ¥1,2…」となり桁を誤読させるため (align:"right" でも
      // ellipsis は行末側に出るので回避できない)。ColumnDef.title は truncate と
      // セットでしか出ないのでツールチップ救済もできない。
      //
      // 上限の無い列が危険なのは「その列以降の閾値がまとめてずれる」からなので、
      // 落とす順序の最下位 (= 最大の閾値) に置いて後続を作らないことで無害化する。
      // 予算 189px = 業務上ありうる最大 ¥9,999,999 / ¥999,999 の実測値。
      // 閾値 718 は列幅の和 (717) ではなくテーブルの実 min-content。1px 足りないと
      // その帯で横スクロールが戻るため、和ではなく実測値を採っている。
      // int4 上限 (lib/domain/yen-amount.ts の MAX_YEN_AMOUNT) まで取ると 215px 級に
      // なるが、そこまでの予算は重すぎる。閾値ちょうど付近で異常値が入ったときに
      // 数 px はみ出すだけ、という限定的な劣化に留める。
      minContainerWidth: 718,
      cell: (h) => (
        <span className="tabular-nums">
          {formatYen(h.initial_fee)}
          <span className="text-muted-foreground/70"> / </span>
          {formatYen(h.monthly_fee)}
        </span>
      ),
    },
    {
      key: "ops",
      header: "運用担当",
      // ops_assignee は profiles 参照ではなく素の text (自由入力)。
      // `/stores` の営業担当と同種なので cap も揃える。予算 100px (cap)。
      truncate: true,
      maxWidth: "100px",
      minContainerWidth: 528,
      title: (h) => h.ops_assignee || undefined,
      cell: (h) => h.ops_assignee || "—",
    },
    {
      key: "due",
      header: "期日",
      // formatDate は YYYY/MM/DD 固定長。text-sm なので dashboard の更新列
      // (text-xs) より広い。2 テーブル間で数値を流用しないこと。予算 108px。
      minContainerWidth: 428,
      cell: (h) => formatDate(h.due_date),
    },
    {
      key: "status",
      header: "状態",
      // 閉じた enum (運用確認待ち / 完了) を whitespace-nowrap のバッジで描くため
      // 幅が確定する。予算 120px = 最長の「運用確認待ち」+ padding。
      // フィルタ UI が無い画面での唯一のトリアージ軸なので always に置く。
      cell: (h) => <Badge tone={statusTone[h.status]}>{h.status}</Badge>,
    },
  ];
}

const columns = buildColumns();

export interface HandoffsTableViewProps {
  handoffs: readonly Handoff[];
}

/**
 * 引き継ぎ一覧の描画 (`"use client"`)。`cell` 関数を含む column 定義は
 * `DataTable` (`"use client"`) が RSC 境界越しに受け取れないため、
 * データ取得 (Server) と描画 (本 view) を分離する。
 */
export function HandoffsTableView({ handoffs }: HandoffsTableViewProps) {
  return (
    <Card>
      <Card.Header>
        <Card.Title>引き継ぎ一覧</Card.Title>
        <span className="text-sm text-muted-foreground">
          {handoffs.length} 件
        </span>
      </Card.Header>
      <DataTable
        columns={columns}
        rows={[...handoffs]}
        rowKey={(h) => h.id}
        emptyState={
          <EmptyState
            icon={<ArrowLeftRight />}
            title="引き継ぎはまだありません"
            description="受注済みの商談から引き継ぎシートを作成してください。"
          />
        }
      />
    </Card>
  );
}
