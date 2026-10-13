import { expect, test } from "@playwright/test";

test("メインコンテンツへキーボードで移動でき、320pxで横スクロールしない", async ({ page }) => {
  // dev サーバはページを初回アクセス時にコンパイルする。並列実行中は 30 秒の既定を
  // 超えることがあるため、持ち時間を 3 倍にする (sales-status.spec.ts と同じ)。
  test.slow();
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
