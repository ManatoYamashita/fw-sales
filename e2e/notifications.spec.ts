import { expect, test, type Page } from "@playwright/test";

/**
 * 通知ベルの既読化 (#296)。
 *
 * 固定データは scripts/e2e-setup.mjs の ensureE2eNotifications が投入する
 * (未読 3 件 = 実在店舗 / 削除済み店舗 / リンク無し、既読 1 件)。
 * 既読状態を順に変えていくため、1 本のシナリオとして直列に確かめる。
 */

function bell(page: Page) {
  return page.locator("header").getByRole("button", { name: /^通知 \(/ });
}

async function openPanel(page: Page) {
  await bell(page).click();
  const panel = page.getByRole("dialog", { name: "通知一覧" });
  await expect(panel).toBeVisible();
  return panel;
}

test("通知はクリックで既読になり、削除済み店舗へは遷移せず、一括既読もできる", async ({
  page,
}) => {
  await page.goto("/stores");
  await expect(bell(page)).toHaveAccessibleName("通知 (3 件未読)");

  // 削除済み店舗を指す通知: リンクにならず、クリックしても 404 画面へ飛ばない
  let panel = await openPanel(page);
  const dead = panel.getByRole("button", {
    name: "未読: E2E: 削除済み店舗の通知",
  });
  await expect(dead).toBeVisible();
  await expect(panel.locator('a[href*="store_e2e_deleted"]')).toHaveCount(0);
  await dead.click();
  await expect(page).toHaveURL(/\/stores$/);
  await expect(bell(page)).toHaveAccessibleName("通知 (2 件未読)");
  await expect(
    panel.getByRole("button", { name: "E2E: 削除済み店舗の通知" }),
  ).toBeVisible();

  // 実在店舗を指す通知: 遷移し、既読になる
  await panel
    .getByRole("link", { name: "未読: E2E: 導楽の調査が完了しました" })
    .click();
  await expect(page).toHaveURL(/\/stores\/store_001$/);
  await expect(page.getByText("指定された店舗は見つかりませんでした")).toHaveCount(0);
  await expect(bell(page)).toHaveAccessibleName("通知 (1 件未読)");

  // 既読はサーバーへ保存されている (再読込しても戻らない)
  await expect(async () => {
    await page.reload();
    await expect(bell(page)).toHaveAccessibleName("通知 (1 件未読)", {
      timeout: 2_000,
    });
  }).toPass();

  // 一括既読
  panel = await openPanel(page);
  await panel.getByRole("button", { name: "すべて既読にする" }).click();
  await expect(bell(page)).toHaveAccessibleName("通知 (0 件未読)");
  await expect(panel.getByText("未読なし")).toBeVisible();
  await expect(
    panel.getByRole("button", { name: "すべて既読にする" }),
  ).toHaveCount(0);

  await expect(async () => {
    await page.reload();
    await expect(bell(page)).toHaveAccessibleName("通知 (0 件未読)", {
      timeout: 2_000,
    });
  }).toPass();
});
