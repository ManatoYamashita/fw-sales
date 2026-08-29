/**
 * 「現在の営業状況」カードの編集 draft と、その差分計算。
 *
 * カードは partial edit なので、保存時に送るのは **今回の編集操作で実際に変えた
 * フィールドだけ** でなければならない。触っていないフィールドまで送ると、
 * 別 UI (基本情報カード) や別タブ・別ユーザーの更新を、こちらの古い draft で
 * 黙って巻き戻してしまう (lost update)。
 *
 * 比較対象は必ず **編集開始時に固定した baseline** であって、現在レンダーの
 * store props ではない。props は編集中にも更新されうるため、props と比較すると
 * 「ユーザーは触っていないのに差分あり」と誤判定して同じ巻き戻しが起きる。
 *
 * これは optimistic concurrency control ではない。同じフィールドを同時に
 * 書き換えた場合の write-write conflict は解決しない (既存の
 * `repos.store.update` の read-merge-write 特性のまま)。ここで保証するのは
 * 「今回ユーザーが触っていないフィールドを送らない」ことだけ。
 *
 * React に依存しない純モジュールとして切り出し、実際の差分判定を
 * behavior test で固定する (`__tests__/sales-progress-draft.test.ts`)。
 */

/** カードで直接編集できる 3 項目。値は `""` 正規化済みで `null` を持たない。 */
export interface SalesProgressDraft {
  readonly appointmentDate: string;
  readonly assignedSales: string;
  readonly memo: string;
}

/** draft のキー → Server Action が読む FormData のフィールド名。 */
export const SALES_PROGRESS_FIELD_NAMES = {
  appointmentDate: "appointment_acquired_date",
  assignedSales: "assigned_sales_user_id",
  memo: "memo",
} as const;

/** 差分判定の走査順 (= カードの行順)。 */
const DRAFT_KEYS = ["appointmentDate", "assignedSales", "memo"] as const;

/** 差分計算に必要な store の部分形。 */
export interface SalesProgressSource {
  readonly appointment_acquired_date: string | null;
  readonly assigned_sales_user_id: string | null;
  readonly memo: string;
}

/**
 * store props から編集用 snapshot を作る。
 *
 * baseline と draft 初期値の**唯一の生成元**。両者を別々の props から作ると
 * 開始時点でずれた差分が出るため、呼び出し側は 1 回の結果を共有すること。
 */
export function toSalesProgressDraft(
  store: SalesProgressSource,
): SalesProgressDraft {
  return {
    appointmentDate: store.appointment_acquired_date ?? "",
    assignedSales: store.assigned_sales_user_id ?? "",
    memo: store.memo,
  };
}

/**
 * baseline から変わったフィールドだけを `[FormData 名, 値]` で返す。
 *
 * 空文字も差分として返す (担当あり → 未割当 / アポ取得日 → 未取得 / メモ削除)。
 * Server Action 側の `readNullableString` が `""` を `null` へ正規化するので、
 * ここで truthy 判定して落としてはいけない。
 *
 * 返り値が空配列なら送るものが無い = Server Action を呼ぶ必要がない。
 */
export function getSalesProgressChangedFields(
  baseline: SalesProgressDraft,
  draft: SalesProgressDraft,
): ReadonlyArray<readonly [string, string]> {
  const changed: Array<readonly [string, string]> = [];
  for (const key of DRAFT_KEYS) {
    if (draft[key] !== baseline[key]) {
      changed.push([SALES_PROGRESS_FIELD_NAMES[key], draft[key]]);
    }
  }
  return changed;
}
