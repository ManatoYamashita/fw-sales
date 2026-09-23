import { expect, test } from "@playwright/test";

test("タブは矢印キーでフォーカスと選択状態を移動できる", async ({ page }) => {
  await page.goto("/research");

  const tabs = page.getByRole("tab");
  await expect(tabs).toHaveCount(3);
  await tabs.first().focus();
  await page.keyboard.press("ArrowRight");

  await expect(tabs.nth(1)).toBeFocused();
  await expect(tabs.nth(1)).toHaveAttribute("aria-selected", "true");
});
