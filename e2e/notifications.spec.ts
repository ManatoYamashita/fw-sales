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

/**
 * 本文に通知 ID を含む既読化の Server Action の応答を待つ。
 *
 * 既読化は表示を楽観的に変え、Action の完了を待たない。リンクの通知では、Action は
 * 画面遷移が終わってから送られる。応答の前に再読込すると送信中の Action が中断され、
 * 既読が保存されないまま未読に戻る (#351)。再読込の前にこれを待つ。
 */
function waitForMarkRead(page: Page, notificationId: string) {
  return page.waitForResponse(
    (res) =>
      res.request().method() === "POST" &&
      res.request().headers()["next-action"] !== undefined &&
      (res.request().postData() ?? "").includes(notificationId),
    { timeout: 60_000 },
  );
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
  // dev サーバは店舗詳細や Server Action を初回呼び出し時にコンパイルする。
  // 1 本のシナリオで複数の初回コンパイルを踏むため、既定の 30 秒では足りないことがある。
  test.slow();
  await page.goto("/stores");
  await expect(bell(page)).toHaveAccessibleName("通知 (3 件未読)");

  // 削除済み店舗を指す通知: リンクにならず、クリックしても 404 画面へ飛ばない
  let panel = await openPanel(page);
  const dead = panel.getByRole("button", {
    name: "未読: E2E: 削除済み店舗の通知",
  });
  await expect(dead).toBeVisible();
  await expect(panel.locator('a[href*="store_e2e_deleted"]')).toHaveCount(0);
  const deadRead = waitForMarkRead(page, "notif_e2e_dead");
  await dead.click();
  await expect(page).toHaveURL(/\/stores$/);
  await expect(bell(page)).toHaveAccessibleName("通知 (2 件未読)");
  await expect(
    panel.getByRole("button", { name: "E2E: 削除済み店舗の通知" }),
  ).toBeVisible();

  // 実在店舗を指す通知: 遷移し、既読になる
  const aliveRead = waitForMarkRead(page, "notif_e2e_alive");
  await panel
    .getByRole("link", { name: "未読: E2E: 導楽の調査が完了しました" })
    .click();
  // 初回は /stores/[id] のコンパイルを待つ (既定の 5 秒では遷移前に判定が終わる)
  await expect(page).toHaveURL(/\/stores\/store_001$/, { timeout: 30_000 });
  await expect(page.getByText("指定された店舗は見つかりませんでした")).toHaveCount(0);
  await expect(bell(page)).toHaveAccessibleName("通知 (1 件未読)");

  // 既読はサーバーへ保存されている (再読込しても戻らない)
  await deadRead;
  await aliveRead;
  await expect(async () => {
    await page.reload();
    await expect(bell(page)).toHaveAccessibleName("通知 (1 件未読)", {
      timeout: 2_000,
    });
  }).toPass();

  // 一括既読
  panel = await openPanel(page);
  // 表示は楽観的に 0 件へ変わるので、再読込の前に保存 (Server Action) の完了を待つ。
  // 待たずに reload すると、初回コンパイル中の Action リクエストが捨てられて未読が戻る。
  // 引数の無い Action で要求の本文からは特定できないため、応答の結果 ({ count }) で見分ける
  // (ページ読み込み時の getSessionRoleAction も引数無しの POST を投げる)。
  const markedAll = page.waitForResponse(
    async (res) =>
      res.request().method() === "POST" &&
      res.request().headers()["next-action"] !== undefined &&
      (await res.text()).includes('"count"'),
    { timeout: 60_000 },
  );
  await panel.getByRole("button", { name: "すべて既読にする" }).click();
  await markedAll;
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
