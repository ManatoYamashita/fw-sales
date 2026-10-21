import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";
import { e2eDatabaseUrl } from "./support/e2e-db";

/**
 * 店舗詳細のインライン編集 (`updateStorePatchAction`) の許可リスト (#384 のレビュー) が、
 * 既存の編集画面を壊していないこと。
 *
 * 店舗名・業態 (store-title-inline-edit.spec.ts) と基本情報 (store-contact-email.spec.ts) は
 * ほかの spec が確かめる。ここでは残りの 3 つ (地図・Web 資産・営業資産の保存) を確かめ、
 * どの保存でも編集対象外の列 (tenant_id・作成日時・段階・契約連絡先メール) が変わらないことを見る。
 *
 * 店舗を作って消すため直列で流す。テストごとに seed の店舗を複製した専用の店舗を作る。
 */
test.describe.configure({ mode: "serial" });

test.beforeEach(() => {
  test.slow();
});

const STORE_ID_PREFIX = "store_e2e_384p_";
const sql = postgres(e2eDatabaseUrl(), { prepare: false, max: 1 });

const AI_RESULT = {
  strengths_markdown: "## 強み\n- 駅から近い",
  weaknesses_markdown: "## 弱み\n- 口コミが少ない",
  gourmet_paid_status: "食べログ: 無料掲載",
  gbp_completeness: "- 説明欄: あり",
  call_script: "お世話になっております。",
  confidence: { strengths: 80, weaknesses: 70, gourmet_paid_status: 60, gbp_completeness: 50, call_script: 90 },
};

type Guarded = { tenant_id: string; created_at: string; stage: string; contact_email: string };

async function createStore(suffix: string, aiResult: unknown = null): Promise<string> {
  const id = `${STORE_ID_PREFIX}${suffix}`;
  await sql.begin(async (tx) => {
    await tx`CREATE TEMP TABLE e2e_store ON COMMIT DROP AS SELECT * FROM stores WHERE id = 'store_005'`;
    await tx`UPDATE e2e_store SET id = ${id}, name = ${`E2E編集 ${suffix}`}, contact_email = 'keep-384@example.com',
      lat = NULL, lng = NULL, ai_analysis_result = ${aiResult === null ? null : JSON.stringify(aiResult)}`;
    await tx`INSERT INTO stores SELECT * FROM e2e_store`;
  });
  return id;
}

async function guarded(id: string): Promise<Guarded> {
  const rows = await sql<Guarded[]>`SELECT tenant_id, created_at, stage, contact_email FROM stores WHERE id = ${id}`;
  return rows[0]!;
}

/**
 * 編集ボタンを押して入力欄を出す。hydration の前に押すと何も起きないため、
 * 入力欄が出るまで押し直す (store-basic-info-inline-edit.spec.ts と同じ方式)。
 */
async function startEditing(editButton: ReturnType<Page["getByRole"]>, firstInput: ReturnType<Page["getByLabel"]>) {
  await expect(async () => {
    if (!(await firstInput.isVisible())) await editButton.click();
    await expect(firstInput).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 60_000 });
}

const card = (page: Page, title: string) =>
  page.locator("div.bg-card").filter({ has: page.getByRole("heading", { name: title, exact: true }) });

test.beforeAll(async () => {
  await sql`DELETE FROM stores WHERE id LIKE ${`${STORE_ID_PREFIX}%`}`;
});

test.afterAll(async () => {
  await sql`DELETE FROM stores WHERE id LIKE ${`${STORE_ID_PREFIX}%`}`;
  await sql.end();
});

test("所在地マップ: 緯度経度を保存できる", async ({ page }) => {
  const id = await createStore("map");
  const before = await guarded(id);
  await page.goto(`/stores/${id}`);
  const map = card(page, "所在地マップ");
  await expect(map).toBeVisible({ timeout: 60_000 });
  await startEditing(map.getByRole("button", { name: "緯度経度を編集" }), map.getByLabel("緯度 (lat)"));
  await map.getByLabel("緯度 (lat)").fill("35.6441");
  await map.getByLabel("経度 (lng)").fill("139.6987");
  await map.getByRole("button", { name: "保存" }).click();
  await expect(page.getByText("更新しました")).toBeVisible({ timeout: 60_000 });
  const rows = await sql<{ lat: number; lng: number }[]>`SELECT lat, lng FROM stores WHERE id = ${id}`;
  expect(rows[0]).toEqual({ lat: 35.6441, lng: 139.6987 });
  expect(await guarded(id)).toEqual(before);
});

test("WEB資産・連絡先: 電話番号と URL を保存できる", async ({ page }) => {
  const id = await createStore("web");
  const before = await guarded(id);
  await page.goto(`/stores/${id}`);
  const web = card(page, "WEB資産・連絡先");
  await expect(web).toBeVisible({ timeout: 60_000 });
  await startEditing(web.getByRole("button", { name: "編集" }), web.getByLabel("電話番号"));
  await web.getByLabel("電話番号").fill("03-0000-0384");
  await web.getByLabel("公式サイトURL").fill("https://example.com/384");
  await web.getByRole("button", { name: "保存" }).click();
  await expect(page.getByText("更新しました")).toBeVisible({ timeout: 60_000 });
  const rows = await sql<{ phone: string; site_url: string }[]>`SELECT phone, site_url FROM stores WHERE id = ${id}`;
  expect(rows[0]).toEqual({ phone: "03-0000-0384", site_url: "https://example.com/384" });
  expect(await guarded(id)).toEqual(before);
});

test("営業資産: 編集した架電スクリプトを店舗に保存できる", async ({ page }) => {
  const id = await createStore("assets", AI_RESULT);
  const before = await guarded(id);
  await page.goto(`/research/${id}#sales-assets`);
  const script = page.locator("#ai-call_script");
  await expect(script).toBeVisible({ timeout: 60_000 });
  await script.fill("E2E で書き換えた架電スクリプト");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByText("店舗に保存しました")).toBeVisible({ timeout: 60_000 });
  const rows = await sql<{ ai_analysis_result: string }[]>`SELECT ai_analysis_result FROM stores WHERE id = ${id}`;
  expect(JSON.parse(rows[0]!.ai_analysis_result)).toMatchObject({ call_script: "E2E で書き換えた架電スクリプト" });
  expect(await guarded(id)).toEqual(before);
});
