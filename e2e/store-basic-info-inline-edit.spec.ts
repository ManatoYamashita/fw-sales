import { execFileSync } from "node:child_process";
import { expect, test, type Locator, type Page } from "@playwright/test";
import postgres from "postgres";

/**
 * 店舗の調査情報 (基本情報 53 項目) のインライン編集 (#335)。
 *
 * 値を最初から入力欄で直せること、変更した項目だけ入力欄の直下に保存・取消が出ること、
 * フォーカス移動だけでは未保存の値を捨てないこと、保存中・保存失敗の表示、
 * 狭い幅で保存・取消が切れないことを確かめる。
 *
 * 基本情報を書き換えるため直列で流す。seed の店舗は他の spec も基本情報を書き換える
 * (例: 調査レビューの採用で store_005 に値が入る) ため、seed の店舗を複製した専用の店舗を
 * 基本情報を空にして作り、最後に消す (`research-failure.spec.ts` と同じ方式)。
 */
test.describe.configure({ mode: "serial" });

// dev サーバは店舗詳細・Server Action を初回呼び出し時にコンパイルする。
test.beforeEach(() => {
  test.slow();
});

const STORE_ID = "store_e2e_335";
const STORE_URL = `/stores/${STORE_ID}`;

/**
 * E2E 用 DB の接続先。`scripts/e2e-local.mjs` の `getE2eDatabaseEnv` と同じ解決順。
 * Playwright は spec を CommonJS に変換するため、`import.meta` を使う同ファイルは読み込めない。
 */
function e2eDatabaseUrl(): string {
  if (process.env.E2E_DATABASE_URL) return process.env.E2E_DATABASE_URL;
  const name = process.env.E2E_DB_CONTAINER?.trim() || "fw-sales-e2e-postgres";
  const containers = JSON.parse(
    execFileSync("container", ["list", "--all", "--format", "json"], { encoding: "utf8" }),
  ) as Array<{ id: string; status?: { networks?: Array<{ ipv4Address?: string }> } }>;
  const address = containers.find((c) => c.id === name)?.status?.networks?.[0]?.ipv4Address;
  if (!address) throw new Error(`E2E用PostgreSQLコンテナ「${name}」の内部IPを取得できませんでした。`);
  return `postgres://postgres:postgres@${address.split("/")[0]}:5432/postgres`;
}

const sql = postgres(e2eDatabaseUrl(), { prepare: false, max: 1 });

test.beforeAll(async () => {
  await sql`DELETE FROM stores WHERE id = ${STORE_ID}`;
  await sql.begin(async (tx) => {
    await tx`CREATE TEMP TABLE e2e_store ON COMMIT DROP AS SELECT * FROM stores WHERE id = 'store_005'`;
    await tx`UPDATE e2e_store SET id = ${STORE_ID}, name = 'E2E基本情報', basic_info = '{}'::jsonb`;
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

/** 店舗詳細への Server Action を遅らせる (保存中の表示を観測するため)。 */
async function delayServerActions(page: Page, ms = 1_500) {
  await page.route(`**${STORE_URL}*`, async (route) => {
    if (route.request().method() === "POST" && route.request().headers()["next-action"]) {
      await new Promise((resolve) => setTimeout(resolve, ms));
    }
    await route.continue();
  });
}

const card = (page: Page) =>
  page.locator("div.bg-card").filter({ has: page.getByRole("heading", { name: "店舗の調査情報" }) });
const category = (page: Page) => card(page).locator("summary").filter({ hasText: "店舗の基本情報・特徴" });
const phone = (page: Page) => card(page).getByRole("textbox", { name: "電話番号" });
const concept = (page: Page) => card(page).getByRole("textbox", { name: "お店のコンセプト・特徴" });
/** 項目の行 (`<li>`) の中の保存・取消。 */
const rowOf = (input: Locator) => input.locator("xpath=ancestor::li[1]");
const saveIn = (input: Locator) => rowOf(input).getByRole("button", { name: /^保存/ });
const cancelIn = (input: Locator) => rowOf(input).getByRole("button", { name: "取消" });

/**
 * 最初のカテゴリを開く。ストリーミングの差し替え前に押すと開いた `<details>` ごと
 * 置き換わるため、開いた状態になるまで押し直す。
 */
async function ensureBasicCategoryOpen(page: Page) {
  await expect(async () => {
    const open = await category(page).evaluate((el) => (el.parentElement as HTMLDetailsElement).open);
    if (!open) await category(page).click();
    await expect(phone(page)).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 60_000 });
}

async function openBasicCategory(page: Page) {
  await page.goto(STORE_URL);
  await expect(card(page)).toBeVisible();
  await ensureBasicCategoryOpen(page);
}

async function box(locator: Locator) {
  const b = await locator.boundingBox();
  expect(b, "要素が描画されていない").not.toBeNull();
  return b!;
}

test("用途を冒頭で示し、空欄に信頼度を出さず、値は最初から入力欄で直せる", async ({ page }) => {
  await openBasicCategory(page);
  await expect(card(page)).toContainText("AI調査の結果をレビューで採用すると反映されます");
  await expect(card(page)).toContainText("営業資産の生成に使われます");
  await expect(card(page)).toContainText("入力済み 0 / 53");
  // 表示を切り替える「編集」ボタンも、空欄の「高信頼」も無い
  await expect(card(page).getByRole("button", { name: /編集/ })).toHaveCount(0);
  await expect(card(page)).not.toContainText("高信頼");
  // 色の付いた信頼度は凡例の 3 つだけで、項目の行には無い
  await expect(card(page).locator("[data-trust]")).toHaveCount(3);
  await expect(card(page).locator("li [data-trust]")).toHaveCount(0);

  // 入力欄はそのまま編集でき、変更するまで保存・取消は出ない
  await expect(phone(page)).toBeEditable();
  await expect(saveIn(phone(page))).toHaveCount(0);
});

test("変更した項目だけに保存・取消が出て、フォーカス移動では値を捨てず、取消で元に戻す", async ({ page }) => {
  await openBasicCategory(page);
  await phone(page).fill("03-0000-1111");
  await expect(saveIn(phone(page))).toBeVisible();
  await expect(cancelIn(phone(page))).toBeVisible();
  await expect(rowOf(phone(page))).toContainText("未保存");
  // 他の項目には出ない
  await expect(card(page).getByRole("button", { name: /^保存/ })).toHaveCount(1);

  // Tab でフォーカスを動かしても値と操作は残る (次のフォーカスは同じ行の保存)
  await page.keyboard.press("Tab");
  await expect(saveIn(phone(page))).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(cancelIn(phone(page))).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(phone(page)).toHaveValue("03-0000-1111");
  await expect(saveIn(phone(page))).toBeVisible();

  // カテゴリを閉じても、見出しに未保存の変更があることが出る
  await category(page).click();
  await expect(category(page).getByText("未保存の変更あり")).toBeVisible();
  // 変更の無いカテゴリには出ない
  await expect(
    card(page).locator("summary").filter({ hasText: "立地環境・商圏データ" }).getByText("未保存の変更あり"),
  ).toBeHidden();
  await category(page).click();
  await expect(phone(page)).toHaveValue("03-0000-1111");

  // 取消で保存済みの値 (未入力) に戻し、入力欄にフォーカスを残す
  await cancelIn(phone(page)).click();
  await expect(phone(page)).toHaveValue("");
  await expect(phone(page)).toBeFocused();
  await expect(saveIn(phone(page))).toHaveCount(0);

  // Escape でも取り消せる
  await page.keyboard.type("03-9999");
  await page.keyboard.press("Escape");
  await expect(phone(page)).toHaveValue("");
});

test("保存中は二重に押せず、保存後は値が残り、手入力の値は未評価になる", async ({ page }) => {
  // 保存・再読み込み・空欄保存の 3 往復があり、dev サーバの初回コンパイルと重なると長い。
  test.setTimeout(180_000);
  await delayServerActions(page);
  await openBasicCategory(page);
  await phone(page).fill("03-1234-5678");

  const saved = waitForServerAction(page, "03-1234-5678");
  await phone(page).press("Enter");
  await expect(saveIn(phone(page))).toBeDisabled();
  await expect(saveIn(phone(page))).toHaveAttribute("aria-busy", "true");
  await expect(saveIn(phone(page))).toContainText("保存中");
  await expect(cancelIn(phone(page))).toBeDisabled();
  await saved;

  await expect(page.getByText("「電話番号」を更新しました")).toBeVisible();
  await expect(saveIn(phone(page))).toHaveCount(0);
  await expect(phone(page)).toBeFocused();
  await expect(rowOf(phone(page))).toContainText("未評価");
  // 件数はサーバで数えるため、保存後の再取得を待つ
  await expect(card(page)).toContainText("入力済み 1 / 53", { timeout: 30_000 });

  // 再読み込みしても保存した値が残る (遅延は外して読み直す)
  await page.unrouteAll({ behavior: "wait" });
  await openBasicCategory(page);
  await expect(phone(page)).toHaveValue("03-1234-5678");
  await expect(rowOf(phone(page)).locator("[data-trust]")).toHaveCount(0);

  // 空欄で保存すると未入力へ戻ることを、入力欄の近くで示す
  await phone(page).fill("");
  await expect(rowOf(phone(page))).toContainText("空欄のまま保存すると未入力に戻ります");
  const cleared = waitForServerAction(page, STORE_ID);
  await saveIn(phone(page)).click();
  await cleared;
  await expect(saveIn(phone(page))).toHaveCount(0);
  await expect(card(page)).toContainText("入力済み 0 / 53", { timeout: 30_000 });
});

test("長文は Ctrl+Enter で保存し、Enter は改行、IME 変換中の Enter では保存しない", async ({ page }) => {
  await openBasicCategory(page);
  let posted = 0;
  page.on("request", (req) => {
    if (req.method() === "POST" && req.headers()["next-action"] && (req.postData() ?? "").includes(STORE_ID)) {
      posted += 1;
    }
  });

  await concept(page).click();
  await page.keyboard.type("炭火と地酒");
  await page.keyboard.press("Enter");
  await page.keyboard.type("2行目");
  await expect(concept(page)).toHaveValue("炭火と地酒\n2行目");

  // 変換確定の Enter (isComposing) は保存しない
  await concept(page).evaluate((el) => {
    el.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, isComposing: true, bubbles: true }),
    );
  });
  await page.waitForTimeout(500);
  expect(posted).toBe(0);
  await expect(saveIn(concept(page))).toBeVisible();

  const saved = waitForServerAction(page, STORE_ID);
  await concept(page).press("Control+Enter");
  await saved;
  await expect(saveIn(concept(page))).toHaveCount(0);
  await expect(concept(page)).toHaveValue("炭火と地酒\n2行目");

  // 元に戻す
  await concept(page).fill("");
  const cleared = waitForServerAction(page, STORE_ID);
  await saveIn(concept(page)).click();
  await cleared;
  await expect(saveIn(concept(page))).toHaveCount(0);
});

test("保存に失敗しても入力した値を残し、入力欄の近くで次の操作を示す", async ({ page }) => {
  await openBasicCategory(page);
  await page.route(`**${STORE_URL}*`, async (route) => {
    if (route.request().method() === "POST" && route.request().headers()["next-action"]) {
      await route.abort("failed");
      return;
    }
    await route.continue();
  });
  await phone(page).fill("03-5555-6666");
  await saveIn(phone(page)).click();

  await expect(rowOf(phone(page))).toContainText("保存できませんでした。入力した内容は残っています。");
  await expect(phone(page)).toHaveValue("03-5555-6666");
  await expect(phone(page)).toHaveAttribute("aria-invalid", "true");
  await expect(saveIn(phone(page))).toBeEnabled();
  await cancelIn(phone(page)).click();
  await expect(phone(page)).toHaveValue("");
});

for (const width of [375, 1280]) {
  test(`幅 ${width}px で編集中の保存・取消が入力欄と重ならず、画面内に収まる`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await openBasicCategory(page);
    await concept(page).fill(
      "中目黒の路地裏で、南イタリアの家庭料理と自然派ワインを気軽に楽しめる店。" +
        "https://example.com/a/very/long/url/without/any/break/opportunity/inside/it/at/all",
    );
    const input = await box(concept(page));
    const save = await box(saveIn(concept(page)));
    const cancel = await box(cancelIn(concept(page)));
    for (const b of [save, cancel]) {
      expect(b.x).toBeGreaterThanOrEqual(0);
      expect(b.x + b.width).toBeLessThanOrEqual(width);
      // 入力欄の直下に出る
      expect(b.y).toBeGreaterThanOrEqual(input.y + input.height);
      expect(b.y - (input.y + input.height)).toBeLessThan(24);
      // モバイルでは 44px の操作領域を保つ
      if (width < 768) expect(b.height).toBeGreaterThanOrEqual(44);
    }
    expect(cancel.x).toBeGreaterThanOrEqual(save.x + save.width);
    expect(input.x + input.width).toBeLessThanOrEqual(width);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth),
    ).toBe(0);
    // ボタンの文字が切れていない
    for (const button of [saveIn(concept(page)), cancelIn(concept(page))]) {
      expect(await button.evaluate((el) => el.scrollWidth - el.clientWidth)).toBe(0);
    }
    await cancelIn(concept(page)).click();
  });
}
