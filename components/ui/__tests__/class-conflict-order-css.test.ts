/**
 * クラス衝突ガード (`class-conflicts.test.ts`) が前提にしている**生成 CSS の並び**を固定する
 * (#250)。回帰検知の層としては ② CSS 生成検査 (`docs/architecture/responsive.md` §5)。
 *
 * `cn` は素の clsx なので、同じプロパティのクラスを 2 つ並べたときの勝敗は
 * **生成 CSS 内で後に出た方**で決まる。ガードは「同じプロパティを 2 つ並べたら事故」と
 * 判定するだけで勝者を計算しないが、**その前提が成り立つのは並びが安定しているから**である。
 * Tailwind のアップグレードで並びが変われば、これまでの判断 (どちらが描画されていたか) が
 * 一斉にひっくり返る。ここが落ちたら「勝敗の再評価が要る」というシグナルとして扱うこと。
 */

import { describe, expect, it } from "vitest";
import { buildCss } from "./support/build-css";

/** その候補群をコンパイルし、クラスセレクタの出現位置を返す。 */
async function offsets(candidates: string[]): Promise<Record<string, number>> {
  const css = await buildCss(candidates);
  return Object.fromEntries(
    candidates.map((c) => [c, css.indexOf(`.${c.replace(".", "\\.")}`)]),
  );
}

/** 昇順に並んでいること。左のクラスほど先に出る = 右のクラスが勝つ。 */
function expectAscending(found: Record<string, number>, order: string[]): void {
  const positions = order.map((c) => {
    const at = found[c];
    expect(at, `${c} が生成されていない`).toBeGreaterThan(-1);
    return at ?? -1;
  });
  expect(positions).toEqual([...positions].sort((a, b) => a - b));
}

describe("クラス衝突の勝敗を決める並び", () => {
  it("同じファミリは数値の昇順に出る (= 大きい値が勝つ)", async () => {
    const found = await offsets(["h-7", "h-8", "h-9", "h-11", "gap-1.5", "gap-2"]);

    expectAscending(found, ["h-7", "h-8", "h-9", "h-11"]);
    // `BUTTON_GAP_CLASSES` が存在する理由。基底 `gap-2` と `className="gap-1.5"` を
    // 並べると `gap-2` が勝ち、6px は一度も描画されない。
    expectAscending(found, ["gap-1.5", "gap-2"]);
  });

  it("`px-0` は size の `px-*` に負け、`h-auto` は数値高さに勝つ", async () => {
    // `variant: link` の `px-0 h-auto` が半分しか効かない理由。呼び出しは現状 0 件だが、
    // 使い始めるなら size の打ち消し方から設計し直す必要がある。
    const found = await offsets(["px-0", "px-4", "h-9", "h-11", "h-auto"]);

    expectAscending(found, ["px-0", "px-4"]);
    expectAscending(found, ["h-9", "h-11", "h-auto"]);
  });

  it("辺の指定は軸の指定より後に出る (`px-3 pr-8` は事故ではない)", async () => {
    // `select.tsx` が chevron の場所を空けるために使っている書き方。自己衝突検査が
    // これを事故と数えないのは、この並びが保証されているからである。
    const found = await offsets(["p-0", "px-3", "py-4", "pr-8"]);

    expectAscending(found, ["p-0", "px-3", "pr-8"]);
    expectAscending(found, ["p-0", "py-4"]);
  });

  it("存在しないクラスは生成されない (この検査が空振りしていないことの確認)", async () => {
    const found = await offsets(["gap-notavalue", "h-notavalue"]);

    expect(found["gap-notavalue"]).toBe(-1);
    expect(found["h-notavalue"]).toBe(-1);
  });
});
