/**
 * 「現在の営業状況」カードの partial edit 構造ガード。
 *
 * 以前は編集モードがカード本体を 2 フィールドのグリッドへ丸ごと差し替えており、
 * 「編集」を押すと 7 項目中 5 項目が画面から消えていた。
 * 修正後は **1 つの <dl> を表示モードと編集モードで共有**し、直接値の行だけが
 * 入力欄に変わる。行の増減・順序ずれが構造的に起きない形にしている。
 *
 * 以下はいずれも型エラーにならず画面を開くまで気づけない回帰なので、
 * `stores-table-a11y.test.ts` と同じくソースレベルで機械的に固定する
 * (React component テスト環境が未導入で、新規依存の追加も避けるため)。
 */

import { beforeAll, describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";

let source: string;
/** コメントを除いた実コード。設計意図を書いた JSDoc への誤ヒットを避ける。 */
let code: string;
/**
 * 「現在の営業状況」カード本文だけを切り出したコード。
 * ファイル末尾の ActivityDetails (営業記録の詳細) も <dl> を持つため、
 * 行構造の検証は本文に限定する。
 */
let cardBody: string;
/**
 * saveCurrent (「保存」で送る FormData を組み立てる部分) だけを切り出したコード。
 * どのフィールドをどの条件で送るかは画面を開くまで気づけないので構造で固定する。
 */
let saveCurrentBody: string;

/** カード本文に現れる行ラベルを出現順に抜き出す。 */
function infoLabels(src: string): string[] {
  return [...src.matchAll(/<Info\s+label="([^"]+)"/g)].map((m) => m[1]!);
}

beforeAll(async () => {
  source = await readFile(
    path.join(
      process.cwd(),
      "app/(main)/stores/[id]/_components/sales-progress-card.tsx",
    ),
    "utf8",
  );
  code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const start = code.indexOf('<Card.Body className="space-y-4">');
  const end = code.indexOf("</Card.Body>", start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  cardBody = code.slice(start, end);
  const saveStart = code.indexOf("const saveCurrent = () =>");
  const saveEnd = code.indexOf("return <div", saveStart);
  expect(saveStart).toBeGreaterThan(-1);
  expect(saveEnd).toBeGreaterThan(saveStart);
  saveCurrentBody = code.slice(saveStart, saveEnd);
});

describe("表示モードと編集モードで行が消えない", () => {
  it("カード本文の <dl> は 1 つだけ (モードごとに差し替えない)", () => {
    // 編集用の別グリッドを作ると行がずれる / 消える。構造で防ぐ。
    expect(cardBody.match(/<dl[\s>]/g) ?? []).toHaveLength(1);
  });

  it("7 行を定義順どおりに描画する", () => {
    expect(infoLabels(cardBody)).toEqual([
      "現在の営業状態",
      "調査・架電段階",
      "アポ取得日",
      "営業担当",
      "現在の次回アクション",
      "最終営業日",
      "顧客共有メモ",
    ]);
  });

  it("編集モードでも同じ <dl> を使う (行が editingCurrent で増減しない)", () => {
    // editingCurrent はセルの中身の出し分けにだけ使い、行そのものを条件にしない。
    expect(code).not.toMatch(/\{editingCurrent \?\s*<div className="grid/);
    expect(code).not.toMatch(/\{editingCurrent[^}]*<Info/);
  });
});

describe("直接編集できるのは 3 項目だけ", () => {
  it.each([
    ["アポ取得日", "appointment-date"],
    ["営業担当", "assigned-sales"],
    ["顧客共有メモ", "customer-memo"],
  ])("%s は編集モードで入力要素と label を関連付ける", (_label, id) => {
    expect(code).toContain(`htmlFor={editingCurrent ? "${id}" : undefined}`);
    expect(code).toContain(`id="${id}"`);
  });

  it("derived 項目に入力要素を置かない", () => {
    // 現在の営業状態 / 調査・架電段階 / 現在の次回アクション / 最終営業日 の
    // 各セルに Input / Select / Textarea が現れないこと。
    const labels = infoLabels(cardBody);
    const derived = [
      "現在の営業状態",
      "調査・架電段階",
      "現在の次回アクション",
      "最終営業日",
    ];
    for (const label of derived) {
      const start = cardBody.indexOf(`<Info label="${label}"`);
      expect(start, `${label} の行が見つからない`).toBeGreaterThan(-1);
      const nextLabel = labels[labels.indexOf(label) + 1];
      const end = nextLabel
        ? cardBody.indexOf(`<Info label="${nextLabel}"`)
        : cardBody.indexOf("</dl>");
      const cell = cardBody.slice(start, end);
      expect(cell, `${label} に入力要素がある`).not.toMatch(
        /<(Input|Select|Textarea)[\s/>]/,
      );
    }
  });
});

describe("derived の補助文は編集モードだけ", () => {
  it.each([
    ["現在の営業状態", "営業記録から自動"],
    ["調査・架電段階", "画面上部で変更"],
    ["現在の次回アクション", "営業記録で設定"],
  ])("%s の補助文は editingCurrent のときだけ渡す", (_label, note) => {
    // 通常表示にも出すと読むものが増えて一覧性が落ちる。
    expect(code).toContain(`note={editingCurrent ? "${note}" : undefined}`);
  });

  it("補助文を無条件に渡している行がない", () => {
    expect(code).not.toMatch(/note="/);
  });

  it("最終営業日には補助文を付けない (値自体が状態を語る)", () => {
    const start = cardBody.indexOf('<Info label="最終営業日"');
    const cell = cardBody.slice(start, cardBody.indexOf('<Info label="顧客共有メモ"'));
    expect(cell).not.toContain("note=");
  });
});

describe("アポ取得日の「未取得に戻す」", () => {
  it("Select 化せず type=\"date\" の Input を維持する", () => {
    expect(code).toContain('id="appointment-date" type="date"');
  });

  it("日付が入っているときだけ出す", () => {
    expect(code).toMatch(/\{appointmentDate \? \(/);
    expect(code).toContain("未取得に戻す");
  });

  it("押しても保存せず draft を空にするだけ", () => {
    // その場で Server Action を呼ぶと「保存」「キャンセル」の意味が壊れる。
    expect(code).toContain('setAppointmentDate("")');
    expect(code).not.toMatch(/未取得に戻す[\s\S]{0,200}updateSalesProgressAction/);
  });

  it("押した直後の焦点を日付入力へ移す", () => {
    // 押すと {appointmentDate ? ... : null} が false 側へ倒れてボタン自身が
    // unmount され、焦点が body へ落ちる。キーボード操作では現在位置を失い、
    // 文書先頭から辿り直しになる。
    expect(code).toContain(
      'onClick={() => { setAppointmentDate(""); appointmentInputRef.current?.focus(); }}',
    );
    expect(code).toContain("ref={appointmentInputRef}");
  });

  it("キャンセルで保存済みの日付へ戻せる (resetDraftFromStore と整合)", () => {
    expect(code).toContain("setAppointmentDate(snapshot.appointmentDate)");
    expect(code).toContain(
      "const cancelEditCurrent = () => { resetDraftFromStore(); setEditingCurrent(false); };",
    );
  });
});

describe("営業担当 Select", () => {
  it("未割当を選べる", () => {
    expect(code).toContain('<option value="">未割当</option>');
  });

  it("profiles に無い現在値の受け皿 option を出す", () => {
    // 一致する option が無いと <select> は先頭 (未割当) を表示し、
    // ユーザーが触っていないのに保存で担当が消える。
    expect(code).toContain(
      "const unknownSalesId = store.assigned_sales_user_id && !profileMap.has(store.assigned_sales_user_id) ? store.assigned_sales_user_id : null",
    );
    expect(code).toContain(
      "{unknownSalesId ? <option value={unknownSalesId}>不明な担当者</option> : null}",
    );
  });

  it("draft は resetDraftFromStore で初期化・復元される", () => {
    expect(code).toContain("setAssignedSales(snapshot.assignedSales)");
  });

  it("保存は編集開始時の baseline とだけ比較する (現在 props と比較しない)", () => {
    // 現在レンダーの store props と比較すると、編集中に props だけ更新された場合に
    // 「ユーザーは触っていないのに差分あり」と誤判定し、古い draft で相手の更新を
    // 巻き戻す。比較対象は編集開始時に固定した baseline だけにする。
    expect(saveCurrentBody).toContain(
      "getSalesProgressChangedFields(editBaselineRef.current, { appointmentDate, assignedSales, memo })",
    );
    expect(saveCurrentBody).not.toContain("store.assigned_sales_user_id");
    expect(saveCurrentBody).not.toContain("store.appointment_acquired_date");
    expect(saveCurrentBody).not.toContain("store.memo");
  });

  it("baseline は編集開始のたびに取り直す (前回の baseline を流用しない)", () => {
    expect(code).toContain(
      "const beginEditCurrent = () => { editBaselineRef.current = resetDraftFromStore(); setEditingCurrent(true); };",
    );
    // baseline と draft 初期値は同一 snapshot から作る (別々に props を読まない)。
    expect(code).toContain("const snapshot = toSalesProgressDraft(store);");
    // 編集中に props が届いても baseline を書き換えない = 代入は begin edit の 1 箇所だけ。
    expect(code.match(/editBaselineRef\.current\s*=/g) ?? []).toHaveLength(1);
  });

  it("差分のあるフィールドだけを FormData へ入れる (無条件 set を持たない)", () => {
    expect(saveCurrentBody).toContain(
      "for (const [name, value] of changed) data.set(name, value);",
    );
    // 個別フィールド名を直接 set していないこと (差分判定を迂回する経路を残さない)。
    expect(saveCurrentBody).not.toContain('data.set("appointment_acquired_date"');
    expect(saveCurrentBody).not.toContain('data.set("assigned_sales_user_id"');
    expect(saveCurrentBody).not.toContain('data.set("memo"');
  });

  it("変更が無ければ Server Action を呼ばない", () => {
    // 空 FormData で呼ぶと Server Action は空 patch のまま repos.store.update へ
    // 進む。Server Action 側に特例を足さず client 側で止める。
    const noop = saveCurrentBody.slice(
      saveCurrentBody.indexOf("if (changed.length === 0) {"),
    );
    expect(noop).toContain("if (changed.length === 0) {");
    const guardEnd = noop.indexOf("startTransition");
    expect(guardEnd).toBeGreaterThan(-1);
    expect(noop.slice(0, guardEnd)).not.toContain("updateSalesProgressAction");
    // action 呼び出しは差分ありの経路 1 箇所だけ。
    expect(
      saveCurrentBody.match(/await updateSalesProgressAction\(/g) ?? [],
    ).toHaveLength(1);
  });
});

describe("次回アクションは Deal を単一の書き込み先に保つ", () => {
  it("Store へ next_action を直接書かない", () => {
    expect(code).not.toContain('data.set("next_action_date"');
    expect(code).not.toContain('data.set("next_action_note"');
    expect(code).not.toContain('data.set("next_action_type"');
  });

  it("未設定のときだけ導線を出す (設定済みは下の営業記録カードに導線がある)", () => {
    expect(cardBody).toContain('{currentNext.source === "unset" ? (');
    expect(cardBody).toContain('<NextActionCta onClick={() => setFormTarget("new")} label="次回アクションを設定" />');
  });

  it("導線は既存の営業記録フォームを開くだけ (新しい保存経路を作らない)", () => {
    const cta = code.slice(code.indexOf("function NextActionCta"));
    expect(cta).not.toContain("updateSalesProgressAction");
    expect(cta).not.toContain("Action(");
  });

  it("カードから Deal の担当者を書き換えない", () => {
    // Deal.assigned_sales_user_id は「その活動を誰が行ったか」で別概念。
    // カードが呼ぶ更新系 action は updateSalesProgressAction だけ。
    expect(code).toContain("updateSalesProgressAction");
    expect(code).not.toContain("updateDealAction");
    expect(code).not.toContain("updateStorePatchAction");
  });
});
