/**
 * 設定画面「データ管理」カードの表示 (#298)。
 *
 * - 本番 (`dataResetAllowed=false`) では「シードデータに戻す」「全データを削除」を描画しない
 * - JSON インポートが既存データを消さない (上書き + 追加) ことを画面に書く
 * - `page.tsx` が環境判定の結果を実際に渡している (配線)
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/actions/data-actions", () => ({
  clearAllAction: vi.fn(),
  importJsonAction: vi.fn(),
  resetToSeedAction: vi.fn(),
}));
// Provider の初期値 (未ロード) を返す。実体は Server Action 経由で DB を import してしまう。
vi.mock("@/components/layout/current-user-provider", () => ({
  useIsAdmin: () => ({ isAdmin: false, loaded: false }),
}));

const { DataActions } = await import("../data-actions");

describe("DataActions", () => {
  it("dataResetAllowed=false ではシードリセットと全削除を描画しない", () => {
    const html = renderToStaticMarkup(<DataActions dataResetAllowed={false} />);

    expect(html).not.toContain("シードデータに戻す");
    expect(html).not.toContain("全データを削除");
    expect(html).toContain("JSON エクスポート");
    expect(html).toContain("JSON インポート");
  });

  it("dataResetAllowed=true ではシードリセットと全削除を描画する", () => {
    const html = renderToStaticMarkup(<DataActions dataResetAllowed />);

    expect(html).toContain("シードデータに戻す");
    expect(html).toContain("全データを削除");
  });

  it("インポートが既存データを削除しないことを画面に書く", () => {
    const html = renderToStaticMarkup(<DataActions dataResetAllowed={false} />);

    expect(html).toContain("既存のデータは削除されません");
  });
});

describe("page.tsx の配線", () => {
  it("環境判定の結果を DataActions へ渡す", async () => {
    const page = await readFile(
      path.resolve(import.meta.dirname, "../../page.tsx"),
      "utf8",
    );

    expect(page).toContain(
      "<DataActions dataResetAllowed={isDataResetAllowed()} />",
    );
  });
});
