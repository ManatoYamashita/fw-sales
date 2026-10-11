import { expect, test, type Page } from "@playwright/test";
import { chooseOption } from "./support/select";

/**
 * 営業結果の一覧表示と状態ラベルの統一 (#297)。
 *
 * seed の店舗を書き換えるため直列で流す。書き換える店舗は他の spec が参照しない
 * らーめん 心 (store_004 / 営業記録なし) と CAFE VERDE (store_002) に限る。
 */
test.describe.configure({ mode: "serial" });

// dev サーバは店舗詳細・Server Action を初回呼び出し時にコンパイルする。並列実行中は
// 1 回のコンパイルが 30 秒の既定を超えることがあるため、各テストの持ち時間を 3 倍にする。
test.beforeEach(() => {
  test.slow();
});

/**
 * 本文に `marker` を含む Server Action の POST 応答 (`next-action` ヘッダ付き) を待つ。
 *
 * dev サーバは Action を初回呼び出し時にコンパイルするため、保存結果の確認は応答を
 * 待ってから行う (既定の 5 秒では負荷下で間に合わないことがある)。/stores 系のページは
 * 読み込み時にも別の Action (getSessionRoleAction) を投げるので、本文で取り違えを防ぐ。
 */
const waitForServerAction = (page: Page, marker: string) =>
  page.waitForResponse(
    (res) =>
      res.request().method() === "POST" &&
      res.request().headers()["next-action"] !== undefined &&
      (res.request().postData() ?? "").includes(marker),
    { timeout: 60_000 },
  );

const tableScroller = (page: Page) =>
  page.locator('[class*="@container/data-table"]').first();

/** 一覧テーブルのコンテナ幅が `target` px になるよう viewport を合わせる。 */
async function fitContainerWidth(page: Page, target: number) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const viewport = page.viewportSize()!;
    const width = await tableScroller(page).evaluate((el) => el.clientWidth);
    if (width === target) return;
    await page.setViewportSize({
      width: viewport.width + (target - width),
      height: viewport.height,
    });
  }
  expect(await tableScroller(page).evaluate((el) => el.clientWidth)).toBe(target);
}

test("一覧は営業状態の列を調査段階より優先して出し、ラベルが画面間で揃っている", async ({ page }) => {
  await page.goto("/stores");
  const table = page.getByRole("table");
  await expect(table.getByRole("columnheader", { name: "営業状態" })).toBeVisible();
  await expect(table.getByRole("columnheader", { name: "調査段階" })).toBeVisible();
  await expect(page.getByText("現在の営業状態")).toHaveCount(0);
  await expect(table.getByRole("columnheader", { name: "状態", exact: true })).toHaveCount(0);

  // 営業状態 (778) は残り、調査段階 (898) が先に落ちる帯
  await fitContainerWidth(page, 820);
  await expect(table.getByRole("columnheader", { name: "営業状態" })).toBeVisible();
  await expect(table.getByRole("columnheader", { name: "調査段階" })).toBeHidden();

  // 絞り込みは「営業状態」の 1 本だけ (旧「現在の / 最新の営業状態」の 2 本立てを解消)
  await page.getByRole("button", { name: "絞り込み" }).click();
  const panel = page.getByRole("dialog");
  await expect(panel.getByText("営業状態", { exact: true })).toBeVisible();
  await expect(panel.getByText("最新の営業状態")).toHaveCount(0);
  await expect(panel.getByText("調査段階", { exact: true })).toBeVisible();
});

test("失注と再アプローチ可否を営業記録に残すと、一覧と絞り込みに反映される", async ({ page }) => {
  await page.goto("/stores/store_004?tab=progress");
  await page.getByRole("button", { name: "営業記録を追加" }).first().click();

  const form = page.locator("form").filter({ hasText: "営業記録を追加" }).last();
  await chooseOption(form.getByLabel("営業状態"), "失注");
  await chooseOption(form.getByLabel("再アプローチ"), "再アプローチ不可");
  await form.getByLabel("失注理由").fill("予算が合わず、今期は見送り");
  const saved = waitForServerAction(page, "予算が合わず、今期は見送り");
  await form.getByRole("button", { name: "営業記録を追加" }).click();
  await saved;
  await expect(page.getByText("営業記録を追加しました")).toBeVisible();

  const current = page.locator("dl").first();
  await expect(current.getByText("失注（ロスト）")).toBeVisible();
  await expect(current.getByText("再アプローチ不可")).toBeVisible();

  await page.goto("/stores");
  const row = page.getByRole("row").filter({ hasText: "らーめん 心" });
  await expect(row.getByText("失注（ロスト）")).toBeVisible();
  await expect(row.getByText("再アプローチ不可")).toBeVisible();
  await expect(row.locator('[title="失注理由: 予算が合わず、今期は見送り"]')).toHaveCount(1);

  await page.getByRole("button", { name: "絞り込み" }).click();
  await chooseOption(page.getByRole("dialog").getByLabel("営業状態で絞り込み"), "失注（ロスト）");
  // 絞り込みは URL の書き換え (遷移) で反映する。負荷下では既定の 5 秒を超えることがある。
  await expect(page).toHaveURL(/state=lost/, { timeout: 30_000 });
  const bodyRows = page.getByRole("table").locator("tbody tr");
  await expect(bodyRows).toHaveCount(1);
  await expect(bodyRows.first()).toContainText("らーめん 心");
});

test("営業状態と調査段階の列は、どのコンテナ幅でも横スクロールを生まない", async ({ page }) => {
  // 失注 + 再アプローチの 2 行表示が入った状態 (前のテスト) で、列の予算を実測で確かめる。
  await page.goto("/stores");
  await expect(page.getByRole("table")).toBeVisible();
  const overflows: number[] = [];
  for (let target = 700; target <= 1000; target += 4) {
    await fitContainerWidth(page, target);
    const overflow = await tableScroller(page).evaluate((el) => el.scrollWidth - el.clientWidth);
    if (overflow > 0) overflows.push(target);
  }
  expect(overflows).toEqual([]);
});

test("店舗名に営業メモがあると案内し、候補の店舗名へ直せる", async ({ page }) => {
  await page.goto("/stores/store_002");
  await page.getByRole("button", { name: "店舗名・業態を編集" }).click();
  await page.getByRole("textbox", { name: "店舗名" }).fill("（確バツ）CAFE VERDE");
  const renamed = waitForServerAction(page, "（確バツ）CAFE VERDE");
  await page.getByRole("button", { name: "保存" }).click();
  await renamed;
  await expect(page.getByRole("heading", { level: 1 })).toContainText("（確バツ）CAFE VERDE");

  const note = page.getByRole("note", { name: "店舗名に含まれる営業メモ" });
  await expect(note).toContainText("確バツ");
  await note.getByRole("button", { name: "店舗名を「CAFE VERDE」に直す" }).click();

  // 自動保存はしない。候補が入った編集フォームを開くだけ
  await expect(page.getByRole("textbox", { name: "店舗名" })).toHaveValue("CAFE VERDE");
  const fixed = waitForServerAction(page, '"CAFE VERDE"');
  await page.getByRole("button", { name: "保存" }).click();
  await fixed;
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(/^CAFE VERDE/);
  await expect(note).toHaveCount(0);
});
