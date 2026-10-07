import { expect, test } from "@playwright/test";

// #298: ALLOW_DATA_RESET を立てない環境 (本番と同じ既定) では、
// 設定画面から全削除系の操作に到達できないことを確認する。
test("ALLOW_DATA_RESET の無い環境では設定画面にシードリセットと全削除が出ない", async ({
  page,
}) => {
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "データ管理" })).toBeVisible();

  await expect(
    page.getByText("JSON エクスポート", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("JSON インポート", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("既存のデータは削除されません")).toBeVisible();

  await expect(
    page.getByRole("button", { name: "シードデータに戻す" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "全データを削除" }),
  ).toHaveCount(0);
});
