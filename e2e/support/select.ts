import { expect, type Locator } from "@playwright/test";

/**
 * 共通 Select (#334) で候補を選ぶ。ネイティブの `<select>` ではないので
 * `selectOption` は使えない。利用者と同じくトリガーを押し、候補パネルの選択肢を押す。
 */
export async function chooseOption(trigger: Locator, optionName: string) {
  const page = trigger.page();
  await trigger.click();
  const listbox = page.getByRole("listbox");
  await expect(listbox).toBeVisible();
  await listbox.getByRole("option", { name: optionName, exact: true }).click();
  await expect(listbox).toHaveCount(0);
}
