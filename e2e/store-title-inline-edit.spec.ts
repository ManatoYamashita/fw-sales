import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * 店舗タイトルのインライン編集 (#310 / #321)。
 *
 * 編集の開始 (鉛筆) と確定 (保存・キャンセル) を見出し内の同じ位置で行えること、
 * 狭い画面や長い店舗名でも入力欄と操作ボタンが重ならず見切れないことを確かめる。
 *
 * seed の店舗を書き換えるため直列で流す。書き換える店舗は他の spec が参照しない
 * 炭火焼鳥 鶴丸 (store_003) に限り、最後に元の値へ戻す。
 */
test.describe.configure({ mode: "serial" });

// dev サーバは店舗詳細・Server Action を初回呼び出し時にコンパイルする。
test.beforeEach(() => {
  test.slow();
});

const STORE_URL = "/stores/store_003";
const ORIGINAL_NAME = "炭火焼鳥 鶴丸";
const ORIGINAL_GENRE = "その他";

/** 折り返しの効く和文と、折り返し位置の無い英字列を両方含む長い店舗名。 */
const LONG_NAME =
  "炭火焼鳥 鶴丸 中目黒駅前本店 〜朝挽き地鶏と季節の地酒を味わう大人の隠れ家〜 " +
  "SUMIBIYAKITORITSURUMARUNAKAMEGUROEKIMAEHONTEN";

/** 本文に `marker` を含む Server Action の POST 応答を待つ (sales-status.spec.ts と同じ)。 */
const waitForServerAction = (page: Page, marker: string) =>
  page.waitForResponse(
    (res) =>
      res.request().method() === "POST" &&
      res.request().headers()["next-action"] !== undefined &&
      (res.request().postData() ?? "").includes(marker),
    { timeout: 60_000 },
  );

/**
 * 店舗詳細への Server Action の応答を遅らせる。保存中の表示は応答が速いと一瞬で
 * 消えるため、その間の状態を確実に観測できるようにする。
 */
async function delayServerActions(page: Page, ms = 1_500) {
  await page.route(`**${STORE_URL}*`, async (route) => {
    if (route.request().method() === "POST" && route.request().headers()["next-action"]) {
      await new Promise((resolve) => setTimeout(resolve, ms));
    }
    await route.continue();
  });
}

const heading = (page: Page) => page.getByRole("heading", { level: 1 });
/** 見出し直下の地域・業態の行。 */
const subtitle = (page: Page) => page.locator("h1 + div");
const editButton = (page: Page) => page.getByRole("button", { name: "店舗名・業態を編集" });
const actions = (page: Page) => page.getByRole("group", { name: "店舗名・業態の編集操作" });
const saveButton = (page: Page) => actions(page).getByRole("button", { name: /^保存/ });
const cancelButton = (page: Page) => actions(page).getByRole("button", { name: "キャンセル" });
const nameInput = (page: Page) => page.getByRole("textbox", { name: "店舗名" });
const genreInput = (page: Page) => page.getByRole("textbox", { name: "業態" });

async function box(locator: Locator) {
  const b = await locator.boundingBox();
  expect(b, "要素が描画されていない").not.toBeNull();
  return b!;
}

type Box = { x: number; y: number; width: number; height: number };

function overlaps(a: Box, b: Box): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

/** 入力欄と操作ボタンが重ならず、ボタンが画面内に収まり、横スクロールが無いこと。 */
async function expectNoOverlapOrClip(page: Page) {
  const viewport = page.viewportSize()!;
  const name = await box(nameInput(page));
  const genre = await box(genreInput(page));
  const save = await box(saveButton(page));
  const cancel = await box(cancelButton(page));

  for (const button of [save, cancel]) {
    expect(overlaps(button, name)).toBe(false);
    expect(overlaps(button, genre)).toBe(false);
    expect(button.x).toBeGreaterThanOrEqual(0);
    expect(button.x + button.width).toBeLessThanOrEqual(viewport.width);
  }
  expect(overlaps(save, cancel)).toBe(false);
  // 入力欄自体も画面幅に収まる (長い英字列は break-words で折り返す)。
  expect(name.x + name.width).toBeLessThanOrEqual(viewport.width);

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBe(0);
  // ボタンの文字が折り返したり切れたりしていない。
  for (const button of [saveButton(page), cancelButton(page)]) {
    expect(await button.evaluate((el) => el.scrollWidth - el.clientWidth)).toBe(0);
  }
}

test("編集を始めると、鉛筆アイコンの位置に保存・キャンセルが出る", async ({ page }) => {
  await page.setViewportSize({ width: 1114, height: 668 });
  await page.goto(STORE_URL);
  await expect(heading(page)).toContainText(ORIGINAL_NAME);
  // 表示中は鉛筆だけで、保存・キャンセルはどこにも無い
  await expect(heading(page).getByRole("button", { name: "店舗名・業態を編集" })).toBeVisible();
  await expect(actions(page)).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^保存/ })).toHaveCount(0);

  const pencil = await box(editButton(page));
  const genreBefore = await box(subtitle(page).getByText(ORIGINAL_GENRE, { exact: true }));
  await editButton(page).click();

  // 鉛筆は消え、見出しの中の同じ位置に操作グループが入る
  await expect(editButton(page)).toHaveCount(0);
  await expect(heading(page).getByRole("group", { name: "店舗名・業態の編集操作" })).toBeVisible();
  const group = await box(actions(page));
  expect(Math.abs(group.x - pencil.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(group.y + group.height / 2 - (pencil.y + pencil.height / 2))).toBeLessThanOrEqual(1);

  // 業態欄の下に操作列は無い (保存・キャンセルは 1 組だけ)
  await expect(page.getByRole("button", { name: /^保存/ })).toHaveCount(1);
  await expect(page.getByRole("button", { name: "キャンセル" })).toHaveCount(1);
  const genre = await box(genreInput(page));
  expect((await box(saveButton(page))).y).toBeLessThan(genre.y);

  // PC 幅では見出し行の高さが変わらず、業態の入力位置も動かない
  expect(Math.abs(genre.y - genreBefore.y)).toBeLessThanOrEqual(1);
  expect(Math.abs(genre.x - genreBefore.x)).toBeLessThanOrEqual(1);

  // 状態バッジと地域情報は編集中も残る
  await expect(heading(page).getByText("営業資産", { exact: false })).toBeVisible();
  await expect(subtitle(page)).toContainText("横浜市港北区");
  await expectNoOverlapOrClip(page);
});

test("キーボードで編集を始め、キャンセルすると未保存の値が戻り鉛筆へフォーカスが戻る", async ({ page }) => {
  await page.goto(STORE_URL);
  await editButton(page).focus();
  await page.keyboard.press("Enter");
  await expect(nameInput(page)).toBeFocused();
  await page.keyboard.type("（下書き）");

  // 入力欄の次は見出し内の保存・キャンセル
  await page.keyboard.press("Tab");
  await expect(saveButton(page)).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(cancelButton(page)).toBeFocused();
  await page.keyboard.press("Enter");

  await expect(actions(page)).toHaveCount(0);
  await expect(editButton(page)).toBeFocused();
  await expect(heading(page)).toHaveText(new RegExp(`^${ORIGINAL_NAME}`));

  // 再度開いても下書きは残っていない
  await editButton(page).click();
  await expect(nameInput(page)).toHaveValue(ORIGINAL_NAME);
  await cancelButton(page).click();
});

test("店舗名を空にして保存すると、送信せずにエラーを出して入力欄へ戻す", async ({ page }) => {
  await page.goto(STORE_URL);
  await editButton(page).click();
  await nameInput(page).fill("");

  let posted = false;
  page.on("request", (req) => {
    if (req.method() === "POST" && req.headers()["next-action"] && (req.postData() ?? "").includes("store_003")) {
      posted = true;
    }
  });
  await saveButton(page).click();
  await expect(page.getByRole("alert").filter({ hasText: "店舗名を入力してください" })).toBeVisible();
  await expect(nameInput(page)).toBeFocused();
  await expect(nameInput(page)).toHaveAttribute("aria-invalid", "true");
  // 編集状態は保たれ、操作も見出しに残る
  await expect(actions(page)).toBeVisible();
  expect(posted).toBe(false);
  await cancelButton(page).click();
});

test("保存すると見出しの位置で確定し、保存中は二重に押せない", async ({ page }) => {
  await delayServerActions(page);
  await page.goto(STORE_URL);
  await editButton(page).click();
  await genreInput(page).fill("焼鳥・ワインバー");

  const saved = waitForServerAction(page, "焼鳥・ワインバー");
  await saveButton(page).click();
  // 保存中は保存・キャンセルとも押せず、入力欄も触れない
  await expect(saveButton(page)).toBeDisabled();
  await expect(saveButton(page)).toHaveAttribute("aria-busy", "true");
  await expect(cancelButton(page)).toBeDisabled();
  await saved;

  await expect(page.getByText("更新しました")).toBeVisible();
  await expect(actions(page)).toHaveCount(0);
  await expect(editButton(page)).toBeFocused();
  await expect(subtitle(page).getByText("焼鳥・ワインバー", { exact: true })).toBeVisible();

  // 元に戻す
  await editButton(page).click();
  await genreInput(page).fill(ORIGINAL_GENRE);
  const restored = waitForServerAction(page, ORIGINAL_GENRE);
  await saveButton(page).click();
  await restored;
  await expect(actions(page)).toHaveCount(0);
  await expect(subtitle(page).getByText(ORIGINAL_GENRE, { exact: true })).toBeVisible();
});

for (const width of [375, 1280]) {
  test(`幅 ${width}px で長い店舗名を編集しても、入力欄と操作ボタンが重ならず横スクロールしない`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await delayServerActions(page);
    await page.goto(STORE_URL);
    // 表示中の鉛筆も画面内に収まる
    const pencil = await box(editButton(page));
    expect(pencil.x + pencil.width).toBeLessThanOrEqual(width);

    await editButton(page).click();
    await expectNoOverlapOrClip(page);

    await nameInput(page).fill(LONG_NAME);
    await expectNoOverlapOrClip(page);

    // 保存中の表示 (「保存中…」) へ切り替わっても重ならない。応答を遅らせて、その間に測る。
    const saved = waitForServerAction(page, "SUMIBIYAKITORI");
    await saveButton(page).click();
    await expect(saveButton(page)).toContainText("保存中…");
    await expectNoOverlapOrClip(page);
    await saved;
    await expect(actions(page)).toHaveCount(0);

    // 長い店舗名の表示中も鉛筆が見切れない
    await expect(heading(page)).toContainText("SUMIBIYAKITORI");
    const pencilAfter = await box(editButton(page));
    expect(pencilAfter.x + pencilAfter.width).toBeLessThanOrEqual(width);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
    ).toBe(0);

    // 元に戻す
    await editButton(page).click();
    await nameInput(page).fill(ORIGINAL_NAME);
    const restored = waitForServerAction(page, `"${ORIGINAL_NAME}"`);
    await saveButton(page).click();
    await restored;
    await expect(heading(page)).toHaveText(new RegExp(`^${ORIGINAL_NAME}`));
  });
}
