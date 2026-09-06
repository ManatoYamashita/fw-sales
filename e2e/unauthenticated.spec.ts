import { expect, test } from "@playwright/test";

test.use({ storageState: { cookies: [], origins: [] } });

test("未認証ユーザーは主要な保護ルートからログインへ送られる", async ({ page }) => {
  for (const path of ["/stores", "/dashboard", "/deals", "/pipeline"]) {
    await page.goto(path);
    const currentUrl = new URL(page.url());
    expect(currentUrl.pathname, path).toBe("/login");
    expect(currentUrl.searchParams.get("redirect"), path).toBe(path);
  }
});
