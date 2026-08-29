/**
 * 「現在の営業状況」カードの差分判定の behavior test。
 *
 * カードの構造ガード (`sales-progress-card.test.ts`) はソーステキスト検証だが、
 * 「保存時にどのフィールドが実際に送られるか」は挙動そのものなので、
 * React 非依存の純モジュールへ切り出したうえで実際に実行して固定する。
 *
 * 背景 (lost update):
 * カードは以前 3 項目を無条件に FormData へ入れていた。別 UI (基本情報カード) や
 * 別タブ・別ユーザーが同じ店舗を更新しても、こちらの古い draft が全項目を
 * 上書きするため、ユーザーが触っていないフィールドがエラーなく巻き戻っていた。
 * 比較対象を **編集開始時に固定した baseline** に限定して防ぐ。
 */

import { describe, expect, it } from "vitest";
import {
  getSalesProgressChangedFields,
  toSalesProgressDraft,
  type SalesProgressDraft,
} from "../sales-progress-draft";

const BASE: SalesProgressDraft = {
  appointmentDate: "2026-08-01",
  assignedSales: "11111111-2222-4333-8444-555555555555",
  memo: "old",
};
const OTHER_USER = "99999999-8888-4777-8666-555555555555";

/** カード本体と同じ手順で FormData を組み立て、実際に送られる中身を見る。 */
function sentFields(baseline: SalesProgressDraft, draft: SalesProgressDraft) {
  const data = new FormData();
  for (const [name, value] of getSalesProgressChangedFields(baseline, draft)) {
    data.set(name, value);
  }
  return data;
}

/** FormData に載ったフィールド名 (送信されるもの) を返す。 */
function sentNames(baseline: SalesProgressDraft, draft: SalesProgressDraft) {
  return [...sentFields(baseline, draft).keys()];
}

describe("toSalesProgressDraft", () => {
  it("null を \"\" へ正規化する (baseline と draft を同じ形にそろえる)", () => {
    expect(
      toSalesProgressDraft({
        appointment_acquired_date: null,
        assigned_sales_user_id: null,
        memo: "",
      }),
    ).toEqual({ appointmentDate: "", assignedSales: "", memo: "" });
  });

  it("値があればそのまま持つ", () => {
    expect(
      toSalesProgressDraft({
        appointment_acquired_date: "2026-08-01",
        assigned_sales_user_id: BASE.assignedSales,
        memo: "old",
      }),
    ).toEqual(BASE);
  });
});

describe("getSalesProgressChangedFields: 変更したフィールドだけ送る", () => {
  it("Case 1: メモだけ変えたらメモだけ送る", () => {
    const sent = sentFields(BASE, { ...BASE, memo: "new" });
    expect([...sent.keys()]).toEqual(["memo"]);
    expect(sent.get("memo")).toBe("new");
    expect(sent.has("assigned_sales_user_id")).toBe(false);
    expect(sent.has("appointment_acquired_date")).toBe(false);
  });

  it("Case 2: 営業担当を別の人へ変えたら担当だけ送る", () => {
    const sent = sentFields(BASE, { ...BASE, assignedSales: OTHER_USER });
    expect([...sent.keys()]).toEqual(["assigned_sales_user_id"]);
    expect(sent.get("assigned_sales_user_id")).toBe(OTHER_USER);
  });

  it("Case 3: 営業担当 → 未割当 は \"\" を送る (Server Action で null 化)", () => {
    const sent = sentFields(BASE, { ...BASE, assignedSales: "" });
    expect([...sent.keys()]).toEqual(["assigned_sales_user_id"]);
    expect(sent.get("assigned_sales_user_id")).toBe("");
  });

  it("Case 4: アポ取得日 → 未取得 は \"\" を送る (「未取得に戻す」)", () => {
    const sent = sentFields(BASE, { ...BASE, appointmentDate: "" });
    expect([...sent.keys()]).toEqual(["appointment_acquired_date"]);
    expect(sent.get("appointment_acquired_date")).toBe("");
  });

  it("Case 5: メモの全消しも \"\" を送る", () => {
    const sent = sentFields(BASE, { ...BASE, memo: "" });
    expect([...sent.keys()]).toEqual(["memo"]);
    expect(sent.get("memo")).toBe("");
  });

  it("Case 6: 何も変えていなければ 0 件 (Server Action を呼ぶ必要がない)", () => {
    expect(getSalesProgressChangedFields(BASE, { ...BASE })).toEqual([]);
    expect(sentNames(BASE, { ...BASE })).toEqual([]);
  });

  it("複数変えたらその分だけ送る (カードの行順)", () => {
    expect(
      sentNames(BASE, {
        appointmentDate: "2026-09-30",
        assignedSales: OTHER_USER,
        memo: "new",
      }),
    ).toEqual(["appointment_acquired_date", "assigned_sales_user_id", "memo"]);
  });
});

describe("編集開始後に props が更新されても巻き戻さない (lost update)", () => {
  // 編集を開始した時点の店舗。baseline はここで固定される。
  const storeAtEditStart = {
    appointment_acquired_date: "2026-08-01",
    assigned_sales_user_id: BASE.assignedSales,
    memo: "old",
  } as const;

  it("Case 7: 編集中に別 UI が営業担当を変えても、触っていない担当を送らない", () => {
    const baseline = toSalesProgressDraft(storeAtEditStart);
    // 基本情報カード等が担当を別の人へ更新し、新しい props が届いた状態。
    const propsNow = toSalesProgressDraft({
      ...storeAtEditStart,
      assigned_sales_user_id: OTHER_USER,
    });
    expect(propsNow.assignedSales).not.toBe(baseline.assignedSales);

    // ユーザーは担当を触らずメモだけ編集した。
    const draft = { ...baseline, memo: "new" };
    const sent = sentFields(baseline, draft);

    expect([...sent.keys()]).toEqual(["memo"]);
    // 送らない = Server Action の formData.has() が false = 更新しない。
    // これにより新しい担当 (OTHER_USER) が古い値へ巻き戻らない。
    expect(sent.has("assigned_sales_user_id")).toBe(false);
  });

  it("Case 8: アポ取得日・メモも同様に、触っていなければ送らない", () => {
    const baseline = toSalesProgressDraft(storeAtEditStart);
    const propsNow = toSalesProgressDraft({
      appointment_acquired_date: "2026-12-24",
      assigned_sales_user_id: storeAtEditStart.assigned_sales_user_id,
      memo: "他タブで書き換えたメモ",
    });
    expect(propsNow.appointmentDate).not.toBe(baseline.appointmentDate);
    expect(propsNow.memo).not.toBe(baseline.memo);

    // ユーザーは担当だけ変更した。
    const sent = sentFields(baseline, { ...baseline, assignedSales: OTHER_USER });

    expect([...sent.keys()]).toEqual(["assigned_sales_user_id"]);
    expect(sent.has("appointment_acquired_date")).toBe(false);
    expect(sent.has("memo")).toBe(false);
  });

  it("差分判定は baseline と draft だけを見る (props を受け取る余地がない)", () => {
    // 引数は 2 つ。現在 props を渡せない = props と比較する実装へ戻せない。
    expect(getSalesProgressChangedFields).toHaveLength(2);
  });
});

describe("scope: write-write conflict までは解決しない", () => {
  it("同じフィールドを双方が変えた場合は後勝ちのまま (今回の scope 外)", () => {
    // baseline=old / 相手が別値へ更新済みでも、ユーザーが同じ項目を編集したなら
    // その値を送る。optimistic concurrency control は導入しない。
    const sent = sentFields(BASE, { ...BASE, memo: "自分の編集" });
    expect(sent.get("memo")).toBe("自分の編集");
  });
});
