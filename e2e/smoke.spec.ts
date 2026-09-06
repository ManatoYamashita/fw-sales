import { expect, test } from "@playwright/test";

test("認証済みユーザーはseed済みの店舗一覧を開ける", async ({ page }) => {
  await page.goto("/stores");
  await expect(page).toHaveURL(/\/stores$/);
  await expect(
    page.getByRole("heading", { name: "店舗・営業一覧" }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "導楽", exact: true })).toBeVisible();

  const headerUserMenu = page
    .locator("header")
    .getByRole("button", { name: "ユーザーメニュー: E2E Test User" });
  await expect(headerUserMenu).toBeVisible();
  await expect(headerUserMenu).toContainText("E2E Test User");

  await headerUserMenu.click();
  await expect(
    page.getByRole("menuitem", { name: "サインアウト" }),
  ).toBeVisible();
});
