import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";
import { e2eDatabaseUrl } from "./support/e2e-db";

/**
 * 店舗の契約連絡先メールアドレス (#384)。
 *
 * 新規登録・店舗詳細の「基本情報」・店舗全体の編集の 3 つの入口で、入力・表示・コピー・
 * 削除ができること、不正な値を保存しないこと、ほかの項目の保存でアドレスを消さないことを確かめる。
 *
 * 店舗を作って消すため直列で流す。seed の店舗は他の spec も使うので、seed の店舗を複製した
 * 専用の店舗を作り、最後に消す (`store-basic-info-inline-edit.spec.ts` と同じ方式)。
 */
test.describe.configure({ mode: "serial" });

test.beforeEach(() => {
  test.slow();
});

const STORE_ID = "store_e2e_384";
const STORE_URL = `/stores/${STORE_ID}`;
const STORE_NAME = "E2E契約連絡先";
const NEW_STORE_NAME = "E2E契約連絡先の新規店舗";

const sql = postgres(e2eDatabaseUrl(), { prepare: false, max: 1 });

async function savedEmail(id = STORE_ID): Promise<string | undefined> {
  const rows = await sql<{ contact_email: string }[]>`SELECT contact_email FROM stores WHERE id = ${id}`;
  return rows[0]?.contact_email;
}

test.beforeAll(async () => {
  await sql`DELETE FROM stores WHERE id = ${STORE_ID} OR name = ${NEW_STORE_NAME}`;
  await sql.begin(async (tx) => {
    await tx`CREATE TEMP TABLE e2e_store ON COMMIT DROP AS SELECT * FROM stores WHERE id = 'store_005'`;
    await tx`UPDATE e2e_store SET id = ${STORE_ID}, name = ${STORE_NAME}, contact_email = '', genre = '居酒屋'`;
    await tx`INSERT INTO stores SELECT * FROM e2e_store`;
  });
});

test.afterAll(async () => {
  await sql`DELETE FROM stores WHERE id = ${STORE_ID} OR name = ${NEW_STORE_NAME}`;
  await sql.end();
});

/** 店舗詳細の「基本情報」カード (店舗の調査情報のカードとは別)。 */
const basicCard = (page: Page) =>
  page.locator("div.bg-card").filter({ has: page.getByRole("heading", { name: "基本情報", exact: true }) });
const emailRow = (page: Page) =>
  basicCard(page).locator("dl > div").filter({ has: page.getByText("契約連絡先メールアドレス", { exact: true }) });

async function openDetail(page: Page) {
  await page.goto(STORE_URL);
  await expect(basicCard(page)).toBeVisible({ timeout: 60_000 });
}

async function editBasicInfo(page: Page) {
  await basicCard(page).getByRole("button", { name: "編集" }).click();
  return basicCard(page).getByLabel("契約連絡先メールアドレス");
}

async function saveBasicInfo(page: Page) {
  await basicCard(page).getByRole("button", { name: "保存" }).click();
}

test("新規登録で入力したアドレスを、店舗詳細で表示する", async ({ page }) => {
  await page.goto("/stores/new");
  await page.getByLabel("店舗名").fill(NEW_STORE_NAME);
  await page.getByLabel("契約連絡先メールアドレス").fill("  new-contract@example.com ");
  await page.getByRole("button", { name: "登録する" }).click();
  await expect(page).toHaveURL(/\/stores\/store_/, { timeout: 60_000 });
  await expect(basicCard(page)).toBeVisible({ timeout: 60_000 });
  // 前後の空白を除いて保存し、そのまま表示する
  await expect(emailRow(page).getByRole("link", { name: "new-contract@example.com" })).toBeVisible();
  const rows = await sql<{ contact_email: string }[]>`SELECT contact_email FROM stores WHERE name = ${NEW_STORE_NAME}`;
  expect(rows.map((r) => r.contact_email)).toEqual(["new-contract@example.com"]);
});

test("新規登録で不正なアドレスは保存しない", async ({ page }) => {
  await sql`DELETE FROM stores WHERE name = ${NEW_STORE_NAME}`;
  await page.goto("/stores/new");
  await page.getByLabel("店舗名").fill(NEW_STORE_NAME);
  // ブラウザの type="email" は通すが、サーバーの規則 (ドメインにドットが要る) で断る値
  await page.getByLabel("契約連絡先メールアドレス").fill("contract@localhost");
  await page.getByRole("button", { name: "登録する" }).click();
  await expect(page.getByText(/契約連絡先メールアドレスは、半角/)).toBeVisible({ timeout: 60_000 });
  await expect(page).toHaveURL(/\/stores\/new/);
  expect(await sql`SELECT 1 FROM stores WHERE name = ${NEW_STORE_NAME}`).toHaveLength(0);
});

test("基本情報で登録・表示・コピー・削除ができる", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await openDetail(page);
  await expect(emailRow(page)).toContainText("—");

  const input = await editBasicInfo(page);
  await input.fill("contract.team@example.co.jp");
  await saveBasicInfo(page);
  const link = emailRow(page).getByRole("link", { name: "contract.team@example.co.jp" });
  await expect(link).toBeVisible({ timeout: 60_000 });
  await expect(link).toHaveAttribute("href", "mailto:contract.team@example.co.jp");
  expect(await savedEmail()).toBe("contract.team@example.co.jp");

  // コピー: ボタンの名前は「契約連絡先メールアドレスをコピー」、成功すると「コピー済み」に変わる
  await emailRow(page).getByRole("button", { name: "契約連絡先メールアドレスをコピー" }).click();
  await expect(emailRow(page).getByRole("button", { name: /コピー済み/ })).toBeVisible();
  await expect(page.getByText("コピーしました")).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("contract.team@example.co.jp");

  // 空欄にして保存すると消える
  const again = await editBasicInfo(page);
  await expect(again).toHaveValue("contract.team@example.co.jp");
  await again.fill("");
  await saveBasicInfo(page);
  await expect(emailRow(page)).toContainText("—", { timeout: 60_000 });
  await expect(emailRow(page).getByRole("button", { name: /コピー/ })).toHaveCount(0);
  expect(await savedEmail()).toBe("");
});

test("コピーに失敗したら、失敗を知らせる", async ({ page }) => {
  await sql`UPDATE stores SET contact_email = 'copy-fail@example.com' WHERE id = ${STORE_ID}`;
  await openDetail(page);
  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: () => Promise.reject(new Error("denied")) },
    });
  });
  await emailRow(page).getByRole("button", { name: "契約連絡先メールアドレスをコピー" }).click();
  await expect(page.getByText("コピーに失敗しました")).toBeVisible();
  await expect(emailRow(page).getByRole("button", { name: /コピー済み/ })).toHaveCount(0);
});

test("基本情報で不正なアドレスは保存せず、編集を続けられる", async ({ page }) => {
  await sql`UPDATE stores SET contact_email = 'keep@example.com' WHERE id = ${STORE_ID}`;
  await openDetail(page);
  const input = await editBasicInfo(page);
  await input.fill("wrong@@example.com");
  await saveBasicInfo(page);
  await expect(page.getByText(/契約連絡先メールアドレスは、半角/)).toBeVisible({ timeout: 60_000 });
  await expect(input).toBeVisible();
  expect(await savedEmail()).toBe("keep@example.com");
});

test("基本情報でほかの項目を保存しても、編集中に別の人が登録したアドレスを上書きしない", async ({ page }) => {
  await sql`UPDATE stores SET contact_email = '' WHERE id = ${STORE_ID}`;
  await openDetail(page);
  await editBasicInfo(page);
  // 編集を始めた後に、別の人が登録した
  await sql`UPDATE stores SET contact_email = 'other-user@example.com' WHERE id = ${STORE_ID}`;
  await basicCard(page).getByLabel("業態").fill("焼き鳥");
  await saveBasicInfo(page);
  await expect(basicCard(page).getByText("焼き鳥")).toBeVisible({ timeout: 60_000 });
  expect(await savedEmail()).toBe("other-user@example.com");
});

test("店舗全体の編集で、アドレスを変えずに保存すると残り、変えると保存される", async ({ page }) => {
  await sql`UPDATE stores SET contact_email = 'edit-page@example.com', memo = '' WHERE id = ${STORE_ID}`;
  await page.goto(`${STORE_URL}/edit`);
  const input = page.getByLabel("契約連絡先メールアドレス");
  await expect(input).toHaveValue("edit-page@example.com", { timeout: 60_000 });
  await page.getByLabel("メモ").fill("E2E メモ");
  await page.getByRole("button", { name: "保存する" }).click();
  await expect(page).toHaveURL(new RegExp(`${STORE_URL}$`), { timeout: 60_000 });
  expect(await savedEmail()).toBe("edit-page@example.com");

  await page.goto(`${STORE_URL}/edit`);
  await page.getByLabel("契約連絡先メールアドレス").fill("changed@example.com");
  await page.getByRole("button", { name: "保存する" }).click();
  await expect(page).toHaveURL(new RegExp(`${STORE_URL}$`), { timeout: 60_000 });
  await expect(emailRow(page).getByRole("link", { name: "changed@example.com" })).toBeVisible();
  expect(await savedEmail()).toBe("changed@example.com");
});

test("一覧・パイプラインの画面には、アドレスを渡さない", async ({ page }) => {
  await sql`UPDATE stores SET contact_email = 'not-in-list@example.com' WHERE id = ${STORE_ID}`;
  for (const url of ["/stores", "/pipeline", "/dashboard", "/research", `/research/${STORE_ID}`]) {
    const response = await page.goto(url);
    expect(response?.ok(), url).toBe(true);
    await page.waitForLoadState("networkidle");
    expect(await page.content(), url).not.toContain("not-in-list@example.com");
  }
  // 店舗詳細には出る (比較のため)
  await openDetail(page);
  await expect(page.getByText("not-in-list@example.com")).toBeVisible();
});

test.describe("スマートフォンの幅", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test("長いアドレスでも横にはみ出さず、コピーボタンを押せる", async ({ page }) => {
    const long = `${"very-long-contract-address".repeat(2)}@${"sub".repeat(10)}.example.co.jp`;
    await sql`UPDATE stores SET contact_email = ${long} WHERE id = ${STORE_ID}`;
    await openDetail(page);
    await expect(emailRow(page).getByRole("link", { name: long })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    const button = emailRow(page).getByRole("button", { name: "契約連絡先メールアドレスをコピー" });
    await expect(button).toBeInViewport();
  });
});
