import { expect, test, type Locator, type Page } from "@playwright/test";
import postgres from "postgres";
import { e2eDatabaseUrl } from "./support/e2e-db";
import { chooseOption } from "./support/select";

/**
 * 全画面のプルダウンを共通の独自 UI へ統一する (#334)。
 *
 * 共通 Select の開閉・キー操作・フォーカス管理と、代表的な 3 つの使われ方
 * (即時更新 / FormData 送信 / 絞り込み・並び替えの URL) を実ブラウザで確かめる。
 *
 * 店舗の調査段階と営業記録を書き換えるため直列で流し、seed の店舗を複製した専用の
 * 店舗を作って最後に消す (`research-failure.spec.ts` と同じ方式)。
 */
test.describe.configure({ mode: "serial" });

// dev サーバは店舗詳細・Server Action を初回呼び出し時にコンパイルする。
test.beforeEach(() => {
  test.slow();
});

const STORE_ID = "store_e2e_334";
const STORE_URL = `/stores/${STORE_ID}`;

const sql = postgres(e2eDatabaseUrl(), { prepare: false, max: 1 });

test.beforeAll(async () => {
  await sql`DELETE FROM stores WHERE id = ${STORE_ID}`;
  await sql.begin(async (tx) => {
    await tx`CREATE TEMP TABLE e2e_store ON COMMIT DROP AS SELECT * FROM stores WHERE id = 'store_004'`;
    await tx`UPDATE e2e_store SET id = ${STORE_ID}, name = 'E2Eプルダウン', stage = '未調査'`;
    await tx`INSERT INTO stores SELECT * FROM e2e_store`;
  });
});

test.afterAll(async () => {
  await sql`DELETE FROM stores WHERE id = ${STORE_ID}`;
  await sql.end();
});

/** 本文に `marker` を含む Server Action の POST 応答を待つ (sales-status.spec.ts と同じ)。 */
const waitForServerAction = (page: Page, marker: string) =>
  page.waitForResponse(
    (res) =>
      res.request().method() === "POST" &&
      res.request().headers()["next-action"] !== undefined &&
      (res.request().postData() ?? "").includes(marker),
    { timeout: 60_000 },
  );

/** 強調中の候補 (`aria-activedescendant` が指す option) のラベル。 */
async function activeOptionText(trigger: Locator) {
  const id = await trigger.getAttribute("aria-activedescendant");
  expect(id, "aria-activedescendant が無い").toBeTruthy();
  return trigger.page().locator(`[id="${id}"]`).innerText();
}

/** 候補パネルが top layer に出ているか (Popover API)。 */
const isInTopLayer = (listbox: Locator) =>
  listbox.evaluate((el) => el.matches(":popover-open"));

test("調査段階: キーボードで開閉・移動・選択し、即時保存してもフォーカスはトリガーに残る", async ({ page }) => {
  await page.goto(STORE_URL);
  const trigger = page.getByRole("combobox", { name: "調査段階" });
  await expect(trigger).toHaveText("未調査");
  // ブラウザ標準のプルダウンを出すネイティブの select は画面に 1 つも無い。
  await expect(page.locator("select")).toHaveCount(0);

  await trigger.focus();
  await page.keyboard.press("Enter");
  const listbox = page.getByRole("listbox", { name: "調査段階" });
  await expect(listbox).toBeVisible();
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  expect(await isInTopLayer(listbox)).toBe(true);
  // 開いた直後は選択中の候補を強調し、チェックの付いた候補が選択状態として伝わる。
  expect(await activeOptionText(trigger)).toBe("未調査");
  await expect(listbox.getByRole("option", { name: "未調査" })).toHaveAttribute("aria-selected", "true");

  await page.keyboard.press("ArrowDown");
  expect(await activeOptionText(trigger)).toBe("調査済み");
  await page.keyboard.press("End");
  expect(await activeOptionText(trigger)).toBe("架電済み");
  await page.keyboard.press("Home");
  expect(await activeOptionText(trigger)).toBe("未調査");

  // Esc は値を変えずに閉じ、フォーカスはトリガーのまま。
  await page.keyboard.press("Escape");
  await expect(listbox).toHaveCount(0);
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await expect(trigger).toHaveText("未調査");
  await expect(trigger).toBeFocused();

  // Space で開き、矢印で移動して Enter で選ぶと即時保存する。
  await page.keyboard.press(" ");
  await expect(listbox).toBeVisible();
  await page.keyboard.press("ArrowDown");
  const saved = waitForServerAction(page, STORE_ID);
  await page.keyboard.press("Enter");
  await saved;
  await expect(listbox).toHaveCount(0);
  await expect(page.getByText("状態を「調査済み」に変更しました")).toBeVisible();
  await expect(trigger).toHaveText("調査済み");
  await expect(trigger).toBeEnabled();
  // 保存中の disabled でフォーカスが body へ落ちたままにならない。
  await expect(trigger).toBeFocused();

  await page.reload();
  await expect(page.getByRole("combobox", { name: "調査段階" })).toHaveText("調査済み");
});

test("調査段階: マウスで開き、外側のクリックや Tab では値を変えずに閉じる", async ({ page }) => {
  await page.goto(STORE_URL);
  const trigger = page.getByRole("combobox", { name: "調査段階" });
  await expect(trigger).toHaveText("調査済み");

  await trigger.click();
  const listbox = page.getByRole("listbox");
  await expect(listbox).toBeVisible();
  // ホバーで強調が移る。
  await listbox.getByRole("option", { name: "架電済み" }).hover();
  expect(await activeOptionText(trigger)).toBe("架電済み");
  await page.getByRole("heading", { level: 1 }).click();
  await expect(listbox).toHaveCount(0);
  await expect(trigger).toHaveText("調査済み");

  await trigger.click();
  await expect(listbox).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Tab");
  await expect(listbox).toHaveCount(0);
  await expect(trigger).not.toBeFocused();
  await expect(trigger).toHaveText("調査済み");
});

test("営業記録: 文字入力で候補を移動し、画面下端では上に開き、選んだ値を FormData で送信する", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 700 });
  await page.goto(`${STORE_URL}?tab=progress`);
  const form = page.locator("form").filter({ hasText: "営業記録を追加" }).last();
  // hydration 前に押すとフォームが開かないので、開くまで押し直す。
  await expect(async () => {
    if (!(await form.isVisible())) {
      await page.getByRole("button", { name: "営業記録を追加" }).first().click();
    }
    await expect(form.getByRole("combobox", { name: "活動種別" })).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 60_000 });

  // 活動種別: 閉じた状態で文字を打つと、その文字で始まる候補を強調して開く。
  // 開いている間は候補パネルも同じ名前を持つので、役割で特定する。
  const meetingType = form.getByRole("combobox", { name: "活動種別" });
  await expect(meetingType).toHaveText("対面");
  await meetingType.focus();
  await page.keyboard.press("d");
  await expect(page.getByRole("listbox", { name: "活動種別" })).toBeVisible();
  expect(await activeOptionText(meetingType)).toBe("DM");
  await page.keyboard.press("Enter");
  await expect(meetingType).toHaveText("DM");
  // フォームのリセットで非制御の Select は初期値へ戻る (ネイティブの select と同じ)。
  await form.evaluate((el) => (el as HTMLFormElement).reset());
  await expect(meetingType).toHaveText("対面");
  await meetingType.focus();
  await page.keyboard.press("d");
  await page.keyboard.press("Enter");
  await expect(meetingType).toHaveText("DM");

  // モバイル幅でも候補は 44px 以上のタッチ領域を持つ。
  await chooseOption(form.getByRole("combobox", { name: "営業状態" }), "継続追客");

  // 次回アクション種別: 画面の下端に寄せてから開くと、上方向へ開いて画面内に収まる。
  const nextType = form.getByRole("combobox", { name: "次回アクション種別" });
  await nextType.evaluate((el) => el.scrollIntoView({ block: "end" }));
  await nextType.click();
  const listbox = page.getByRole("listbox");
  await expect(listbox).toBeVisible();
  await expect(listbox).toHaveAttribute("data-side", "top");
  const panel = (await listbox.boundingBox())!;
  const triggerBox = (await nextType.boundingBox())!;
  expect(panel.y).toBeGreaterThanOrEqual(0);
  expect(panel.y + panel.height).toBeLessThanOrEqual(triggerBox.y);
  expect(panel.x).toBeGreaterThanOrEqual(0);
  expect(panel.x + panel.width).toBeLessThanOrEqual(375);
  const optionBox = (await listbox.getByRole("option").first().boundingBox())!;
  expect(optionBox.height).toBeGreaterThanOrEqual(44);
  await listbox.getByRole("option", { name: "見積確認" }).click();
  await expect(nextType).toHaveText("見積確認");

  const marker = "E2E334 プルダウンの送信確認";
  await form.getByLabel("営業メモ").fill(marker);
  const saved = waitForServerAction(page, marker);
  await form.getByRole("button", { name: "営業記録を追加" }).click();
  const response = await saved;
  // 非表示の入力に入った値が FormData として届いている。
  const body = response.request().postData() ?? "";
  expect(body).toContain("DM");
  expect(body).toContain("継続追客");
  expect(body).toContain("見積確認");
  await expect(page.getByText("営業記録を追加しました")).toBeVisible();

  const latest = page.locator("div.bg-card").filter({ has: page.getByText("最新の営業記録") });
  await expect(latest.getByText("DM", { exact: true })).toBeVisible();
  await expect(latest.getByText("継続追客").first()).toBeVisible();
  await expect(latest.getByText(/見積確認/)).toBeVisible();
});

test("絞り込みパネル (スクロール領域) の中でも候補が切れず、Esc は Select だけを閉じる", async ({ page }) => {
  await page.goto("/stores");
  await page.getByRole("button", { name: "絞り込み" }).click();
  const dialog = page.getByRole("dialog");
  const trigger = dialog.getByRole("combobox", { name: "営業担当で絞り込み" });
  await trigger.click();
  const listbox = page.getByRole("listbox");
  await expect(listbox).toBeVisible();
  expect(await isInTopLayer(listbox)).toBe(true);

  // 最後の候補の中心が、パネル外の要素に覆われずに候補自身を指す (切れていない)。
  const last = listbox.getByRole("option").last();
  await last.scrollIntoViewIfNeeded();
  const covered = await last.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return hit !== null && el.contains(hit);
  });
  expect(covered).toBe(true);

  await page.keyboard.press("Escape");
  await expect(listbox).toHaveCount(0);
  await expect(dialog).toBeVisible();
  await expect(trigger).toBeFocused();

  // 選ぶと URL の絞り込みへ反映し、パネルは開いたまま。
  await chooseOption(trigger, "未割当");
  await expect(page).toHaveURL(/sales=none/);
  await expect(dialog).toBeVisible();
});

test("375px の並び替え: 独自パネルで基準を選ぶと、絞り込みを残したまま URL の並びが変わる", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 900 });
  await page.goto("/stores?q=%E3%83%88%E3%83%A9%E3%83%83%E3%83%88%E3%83%AA%E3%82%A2&sort=next&dir=desc");
  const trigger = page.getByRole("combobox", { name: "並び替えの基準" });
  await expect(trigger).toHaveText("次回アクション");
  const box = (await trigger.boundingBox())!;
  expect(box.height).toBeGreaterThanOrEqual(44);

  await chooseOption(trigger, "店舗名");
  await expect(page).toHaveURL((url) => url.searchParams.get("sort") === "name");
  expect(new URL(page.url()).searchParams.get("q")).toBe("トラットリア");
  await expect(trigger).toHaveText("店舗名");
});
