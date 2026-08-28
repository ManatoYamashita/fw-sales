/**
 * 一覧が 0 件のときの案内文のテスト。
 *
 * クイックフィルタで「今日」を選んで 0 件になったときに
 * 「店舗を新しく登録してください」と案内するのは的外れなので、
 * 条件が効いているかどうかで文面を切り替える。
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// 対象モジュールは Server Action を import しており、その先の repos → lib/db が
// 実 DB 接続を試みるためモックで遮断する (store-delete-confirm-dialog.test.ts と同規約)。
vi.mock("@/lib/actions/store-actions", () => ({
  bulkDeleteStoresAction: vi.fn(),
  deleteStoreAction: vi.fn(),
  getStoreDeleteImpactAction: vi.fn(),
}));

const { buildEmptyState } = await import("../stores-table-view");

const markupOf = (isFiltered: boolean) =>
  renderToStaticMarkup(<>{buildEmptyState(isFiltered)}</>);

describe("buildEmptyState", () => {
  it("絞り込み中は条件の変更・解除を案内する", () => {
    const markup = markupOf(true);
    expect(markup).toContain("現在の条件に一致する店舗はありません");
    expect(markup).toContain("条件を変更または解除してください。");
  });

  it("絞り込み中は新規登録を勧めない", () => {
    // 「今日」で 0 件のときに店舗登録を勧めるのが不自然だったための変更。
    expect(markupOf(true)).not.toContain("登録");
  });

  it("条件なしのときは従来どおり新規登録を案内する", () => {
    const markup = markupOf(false);
    expect(markup).toContain("該当する店舗がありません");
    expect(markup).toContain("検索条件を変更するか、店舗を新しく登録してください。");
  });

  it("どちらの状態でも見出しと説明が空でない", () => {
    for (const isFiltered of [true, false]) {
      const markup = markupOf(isFiltered);
      expect(markup).toContain("<p");
      expect(markup.length).toBeGreaterThan(50);
    }
  });

  it("状態によって異なる案内になる", () => {
    expect(markupOf(true)).not.toBe(markupOf(false));
  });
});
