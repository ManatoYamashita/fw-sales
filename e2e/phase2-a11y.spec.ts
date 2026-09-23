import { expect, test } from "@playwright/test";

test("メインコンテンツへキーボードで移動でき、320pxで横スクロールしない", async ({ page }) => {
  await page.goto("/stores");

  await expect(
    page.getByRole("heading", { name: "店舗・営業一覧", level: 1 }),
  ).toBeVisible();

  const skipLink = page.getByRole("link", { name: "メインコンテンツへスキップ" });
  await skipLink.focus();
  await expect(skipLink).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.locator("#main-content")).toBeFocused();

  await page.setViewportSize({ width: 320, height: 900 });
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "店舗・営業一覧", level: 1 }),
  ).toBeVisible();

  const dimensions = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
});
