"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Modal, ModalContent, ModalFooter } from "@/components/ui/modal";
import { getStoreDeleteImpactAction } from "@/lib/actions/store-actions";
import type { StoreDeleteImpact } from "@/types/store";

/**
 * 店舗削除の確認ダイアログ (3 経路共通 / store-cascade-delete Issue #152)。
 *
 * - 削除ロジックは持たない。承認は `onConfirm` で呼び出し元に委譲し、
 *   削除 action の実行と後続遷移 (redirect / refresh / toast) は呼び出し元の責務
 * - open のたびに影響カウント action を 1 回だけ呼び、取得中 / 取得失敗 / 取得成功の
 *   3 状態を描画する。読み取りの失敗・遅延は削除可否を左右しないため、
 *   いずれの状態でも承認ボタンは有効のまま (design.md D6)
 * - 表示件数は open 時点のスナップショット。確定までの増減は反映しない (TOCTOU 許容)
 */

/** 削除対象。単体は店舗名の表示、一括は件数の表示に用いる。 */
export type StoreDeleteTarget =
  | { kind: "single"; storeId: string; storeName: string }
  | { kind: "bulk"; storeIds: readonly string[] };

export interface StoreDeleteConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target: StoreDeleteTarget;
  /** 承認時に呼ばれる。削除 action の実行と後続遷移は呼び出し元の責務。 */
  onConfirm: () => void;
  /** 削除 action 実行中。承認 / キャンセルを disabled にする。 */
  pending: boolean;
}

type ImpactEffect = "delete" | "unlink";

interface ImpactCategoryDef {
  key: keyof StoreDeleteImpact;
  label: string;
  effect: ImpactEffect;
}

/**
 * カテゴリ表示定義 (単一の真実)。表示順もこの配列順に従う。
 * stores を参照する子テーブルが増えた場合は、getDeleteImpact / FK ポリシーと
 * あわせてここへ追加する (design.md §Revalidation Triggers)。
 */
export const DELETE_IMPACT_CATEGORIES: readonly ImpactCategoryDef[] = [
  { key: "deals", label: "商談", effect: "delete" },
  { key: "research", label: "調査", effect: "delete" },
  { key: "handoffs", label: "引き継ぎ", effect: "delete" },
  { key: "place_candidates", label: "場所候補", effect: "unlink" },
];

/** 処理種別の利用者向けラベル。 */
export const IMPACT_EFFECT_LABEL: Record<ImpactEffect, string> = {
  delete: "同時に削除",
  unlink: "紐付け解除",
};

export interface VisibleImpactEntry {
  key: keyof StoreDeleteImpact;
  label: string;
  effect: ImpactEffect;
  count: number;
}

/** 件数 > 0 のカテゴリのみを定義順で返す (0 件カテゴリは非表示 / Req 3.3)。 */
export function visibleImpactEntries(
  impact: StoreDeleteImpact,
): VisibleImpactEntry[] {
  return DELETE_IMPACT_CATEGORIES.map((c) => ({
    key: c.key,
    label: c.label,
    effect: c.effect,
    count: impact[c.key],
  })).filter((entry) => entry.count > 0);
}

/** 対象 ID 群を effect の依存キーへ直列化する。ID は `<entity>_<id>` 形式で改行を含まない。 */
const IDS_KEY_SEPARATOR = "\n";

export function StoreDeleteConfirmDialog({
  open,
  onOpenChange,
  target,
  onConfirm,
  pending,
}: StoreDeleteConfirmDialogProps) {
  const targetIds =
    target.kind === "single" ? [target.storeId] : target.storeIds;
  const idsKey = targetIds.join(IDS_KEY_SEPARATOR);

  const [impact, setImpact] = useState<StoreDeleteImpact | null>(null);
  const [impactError, setImpactError] = useState(false);
  const [isLoadingImpact, startImpactLoad] = useTransition();
  // close → 再 open の stale 応答を破棄するための世代トークン
  const fetchSeqRef = useRef(0);

  useEffect(() => {
    if (!open) return;
    const seq = ++fetchSeqRef.current;
    // 依存を idsKey (プリミティブ) に限定するため、effect 内で ID 群を復元する
    const ids = idsKey === "" ? [] : idsKey.split(IDS_KEY_SEPARATOR);
    // 状態リセットも transition 内で行う (react-hooks/set-state-in-effect 対応)。
    // リセットは await 前 = dispatch 時点で同期実行されるため、後発 open のリセットが
    // 先発の結果より後に走ることはなく、結果の採否は世代トークン seq が防衛する。
    startImpactLoad(async () => {
      setImpact(null);
      setImpactError(false);
      const result = await getStoreDeleteImpactAction(ids);
      if (fetchSeqRef.current !== seq) return;
      if (result.ok) {
        setImpact(result.data);
      } else {
        setImpactError(true);
      }
    });
  }, [open, idsKey, startImpactLoad]);

  const entries = impact ? visibleImpactEntries(impact) : [];

  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <ModalContent
        title={
          target.kind === "single"
            ? "店舗を削除しますか?"
            : "選択中の店舗を削除しますか?"
        }
        size="sm"
      >
        <div className="space-y-3">
          <p className="text-sm text-foreground leading-relaxed">
            {target.kind === "single" ? (
              <>
                「
                <strong className="font-semibold">{target.storeName}</strong>
                」を削除します。
              </>
            ) : (
              <>
                選択中の
                <strong className="font-semibold">
                  {" "}
                  {target.storeIds.length} 件{" "}
                </strong>
                の店舗を削除します。
              </>
            )}
          </p>

          {/* 影響カウント: 非同期取得のため aria-live で読み上げに追従させる */}
          <div aria-live="polite" className="text-sm leading-relaxed">
            {isLoadingImpact ? (
              <p className="text-muted-foreground">紐づけデータを確認中…</p>
            ) : impactError ? (
              <p className="text-muted-foreground">
                紐づけデータの件数を取得できませんでした。
                関連データがある場合は同時に削除されます。
              </p>
            ) : impact ? (
              entries.length === 0 ? (
                <p className="text-muted-foreground">紐づけデータはありません。</p>
              ) : (
                <ul className="space-y-1 rounded-md border border-border bg-muted/30 px-3 py-2">
                  {entries.map((entry) => (
                    <li
                      key={entry.key}
                      className="flex items-baseline justify-between gap-3"
                    >
                      <span className="text-foreground">
                        {entry.label}{" "}
                        <strong className="font-semibold">
                          {entry.count} 件
                        </strong>
                      </span>
                      <span
                        className={
                          entry.effect === "delete"
                            ? "text-destructive"
                            : "text-muted-foreground"
                        }
                      >
                        {IMPACT_EFFECT_LABEL[entry.effect]}
                      </span>
                    </li>
                  ))}
                </ul>
              )
            ) : null}
          </div>

          <p className="text-sm text-foreground leading-relaxed">
            この操作は取り消せません。
          </p>
        </div>
        <ModalFooter>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={pending}
          >
            キャンセル
          </Button>
          <Button variant="danger" onClick={onConfirm} disabled={pending}>
            {pending ? "削除中…" : "削除する"}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
