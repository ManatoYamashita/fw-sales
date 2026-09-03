import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * クラス定数が `modal.tsx` へ**実際に配線されている**ことを検査する (#225 Phase 1)。
 *
 * 定数モジュール方式の唯一の弱点は「定数は正しいが誰も使っていない」状態を
 * 見逃すこと。jsdom が無く `ModalContent` の DOM を組み立てられない以上、
 * ソーステキストで塞ぐしかない。
 */

const UI = path.resolve(import.meta.dirname, "..");
const read = (rel: string) => readFile(path.resolve(UI, rel), "utf8");

describe("modal.tsx の配線", () => {
  it("クラス定数モジュールから import している", async () => {
    expect(await read("modal.tsx")).toContain('from "./modal-classes"');
  });

  it("5 つのクラス定数と幅マップをすべて使っている", async () => {
    const source = await read("modal.tsx");
    for (const name of [
      "MODAL_OVERLAY_CLASS",
      "MODAL_DIALOG_CLASS",
      "MODAL_HEADER_CLASS",
      "MODAL_BODY_CLASS",
      "MODAL_FOOTER_CLASS",
      "MODAL_WIDTH_CLASS",
    ]) {
      // import 文と使用箇所で最低 2 回出る。
      const count = source.split(name).length - 1;
      expect(count, `${name} が modal.tsx で使われていない`).toBeGreaterThanOrEqual(2);
    }
  });

  it("旧リテラルが残っていない", async () => {
    // 事故: 定数を足しただけで元のインライン文字列を消し忘れると、
    // 定数テストは緑のまま実際の DOM には古いクラスが載り続ける。
    const source = await read("modal.tsx");
    expect(source).not.toContain("bg-muted/30");
    expect(source).not.toContain('className="px-5 py-4"');
    expect(source).not.toContain("sizeClass");
  });
});

describe("呼び出し側が独自スクローラを作らない", () => {
  it("ai-prompt-template-dialog が max-h / overflow を持たない", async () => {
    // 事故: ModalContent 配下に独自の max-h + overflow-y を置くと入れ子スクロールに
    // なり、スクロールバーが 2 本並んでホイールが境界で引っかかる。
    // 高さは modal.tsx が一元管理する。
    const source = await readFile(
      path.resolve(UI, "../../app/(main)/settings/_components/ai-prompt-template-dialog.tsx"),
      "utf8",
    );
    expect(source).not.toContain("max-h-[60vh]");
    expect(source).not.toContain("overflow-y-auto");
  });
});
