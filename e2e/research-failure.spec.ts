import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";
import { e2eDatabaseUrl } from "./support/e2e-db";

/**
 * AI 調査の失敗・期限超過・進捗の取得失敗を画面へ反映する (#324)。
 * 調査中カードの工程一覧が、工程の進行に合わせて回転アイコンと状態の文言を移す (#323)。
 *
 * 調査 run は E2E 用 DB へ直接書き込んで用意する (AI と Workflow を実際には動かさない)。
 * 他の spec の店舗を汚さないよう、seed の店舗を複製した専用の店舗を作り、最後に消す
 * (run は店舗の削除で一緒に消える)。複製元と同じ値を使うので、一覧の列幅は変わらない。
 */
test.describe.configure({ mode: "serial" });

// dev サーバは調査ページと Server Action を初回呼び出し時にコンパイルする。
test.beforeEach(() => {
  test.slow();
});

const STORE_ID = "store_e2e_324";

const sql = postgres(e2eDatabaseUrl(), { prepare: false, max: 1 });

const minutesFromNow = (minutes: number) => new Date(Date.now() + minutes * 60_000).toISOString();

async function insertRun(id: string, fields: { started_at: string; expires_at: string }) {
  await sql`
    INSERT INTO store_research_runs (id, store_id, status, stage, started_at, expires_at)
    VALUES (${id}, ${STORE_ID}, 'running', 'discovering', ${fields.started_at}, ${fields.expires_at})
  `;
}

test.beforeAll(async () => {
  await sql`DELETE FROM stores WHERE id = ${STORE_ID}`;
  await sql.begin(async (tx) => {
    await tx`CREATE TEMP TABLE e2e_store ON COMMIT DROP AS SELECT * FROM stores WHERE id = 'store_001'`;
    await tx`UPDATE e2e_store SET id = ${STORE_ID}, name = 'E2E調査'`;
    await tx`INSERT INTO stores SELECT * FROM e2e_store`;
  });
});

test.afterEach(async () => {
  await sql`DELETE FROM store_research_runs WHERE store_id = ${STORE_ID}`;
});

test.afterAll(async () => {
  await sql`DELETE FROM stores WHERE id = ${STORE_ID}`;
  await sql.end();
});

const steps = (page: Page) => page.getByRole("navigation", { name: "営業資産ができるまでの手順" });
const researchStep = (page: Page) => steps(page).getByRole("listitem").first();
/** 調査中カードの工程一覧 (#323)。 */
const progressList = (page: Page) => page.getByRole("list", { name: "調査の工程" });
const progressRow = (page: Page, label: string) =>
  progressList(page).getByRole("listitem").filter({ hasText: label });

test("調査中の工程一覧は、工程の進行に合わせて回転アイコンと状態の文言を移す (#323)", async ({
  page,
}) => {
  await insertRun("research_run_e2e_323_progress", {
    started_at: minutesFromNow(-1),
    expires_at: minutesFromNow(29),
  });
  await page.goto(`/research/${STORE_ID}`);

  const spinners = progressList(page).locator("[class*='animate-spin']");
  await expect(spinners).toHaveCount(1);
  await expect(progressRow(page, "Web情報源を検索")).toHaveAttribute("aria-current", "step");
  await expect(progressRow(page, "Web情報源を検索")).toContainText("進行中");
  await expect(progressRow(page, "店舗を確認")).toContainText("完了");
  await expect(progressRow(page, "店舗情報を取得・分析")).toContainText("未着手");
  await expect(page.getByText("店舗情報を取得・分析中")).toHaveCount(0);

  // Workflow が工程を進めたときと同じ形で stage を書き換える。
  await sql`UPDATE store_research_runs SET stage = 'researching' WHERE id = 'research_run_e2e_323_progress'`;

  await expect(progressRow(page, "店舗情報を取得・分析")).toHaveAttribute("aria-current", "step", {
    timeout: 30_000,
  });
  await expect(progressRow(page, "店舗情報を取得・分析")).toContainText("進行中");
  await expect(progressRow(page, "Web情報源を検索")).toContainText("完了");
  await expect(progressRow(page, "Web情報源を検索")).not.toHaveAttribute("aria-current", "step");
  await expect(spinners).toHaveCount(1);
  await expect(progressRow(page, "店舗情報を取得・分析").locator("[class*='animate-spin']")).toHaveCount(1);
  await expect(page.getByText("経過時間:")).toBeVisible();
  await expect(page.getByText("このページを離れても調査は継続されます。")).toBeVisible();
});

test("実行中の調査が失敗したら、ポーリングで上部と本文を失敗の表示に切り替え、再読込後も保つ", async ({
  page,
}) => {
  await insertRun("research_run_e2e_324_fail", {
    started_at: minutesFromNow(-1),
    expires_at: minutesFromNow(29),
  });
  await page.goto(`/research/${STORE_ID}`);

  await expect(researchStep(page)).toContainText("(実行中)");
  await expect(researchStep(page).locator("[class*='animate-spin']")).toHaveCount(1);
  await expect(progressList(page).locator("[class*='animate-spin']")).toHaveCount(1);
  await expect(page.getByText("経過時間:")).toBeVisible();

  // 実行基盤の終了を突き合わせた Action が記録するのと同じ形で失敗を書き込む。
  await sql`
    UPDATE store_research_runs
    SET status = 'failed', error_kind = 'workflow_run_failed',
        error_message = 'AI店舗調査に失敗しました', finished_at = now()
    WHERE id = 'research_run_e2e_324_fail'
  `;

  await expect(page.getByText("調査に失敗しました")).toBeVisible({ timeout: 30_000 });
  await expect(
    page.getByText("調査の処理が途中で止まりました。時間をおいて再調査してください。"),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "再調査する" })).toBeVisible();
  await expect(researchStep(page)).toContainText("(失敗)");
  await expect(steps(page).locator("[class*='animate-spin']")).toHaveCount(0);
  // 調査中カードの工程一覧も消え、回転アイコンを残さない (#323)
  await expect(progressList(page)).toHaveCount(0);
  await expect(page.getByText("経過時間:").filter({ visible: true })).toHaveCount(0);

  await page.reload();
  await expect(researchStep(page)).toContainText("(失敗)");
  await expect(page.getByText("調査に失敗しました")).toBeVisible();
});

test("期限を過ぎた実行中の調査は、上部・本文とも時間超過の異常として出し、「中断しました」とは言わない", async ({
  page,
}) => {
  await insertRun("research_run_e2e_324_overdue", {
    started_at: minutesFromNow(-31),
    expires_at: minutesFromNow(-1),
  });
  await page.goto(`/research/${STORE_ID}`);

  await expect(researchStep(page)).toContainText("(時間超過)");
  await expect(steps(page).locator("[class*='animate-spin']")).toHaveCount(0);
  await expect(progressList(page)).toHaveCount(0);
  await expect(page.getByText("上限の時間を過ぎても調査が終わっていません")).toBeVisible();
  await expect(page.getByRole("button", { name: "再調査する" })).toBeVisible();
  await expect(page.getByText("中断しました").filter({ visible: true })).toHaveCount(0);
});

test("進捗を取得できないときは「進捗を確認できません」と出し、再確認で戻る", async ({ page }) => {
  await insertRun("research_run_e2e_324_offline", {
    started_at: minutesFromNow(-1),
    expires_at: minutesFromNow(29),
  });
  await page.goto(`/research/${STORE_ID}`);
  await expect(researchStep(page)).toContainText("(実行中)");

  // Server Action (進捗の取得) への POST だけを落とす。
  const isServerAction = (url: URL) => url.pathname.startsWith(`/research/${STORE_ID}`);
  await page.route(isServerAction, (route) =>
    route.request().method() === "POST" && route.request().headers()["next-action"]
      ? route.abort("internetdisconnected")
      : route.continue(),
  );

  const notice = page.getByText("進捗を確認できません。通信状況を確認して、もう一度確認してください。");
  await expect(notice).toBeVisible({ timeout: 30_000 });
  // 調査の失敗とは区別する: 失敗カードは出さず、上部は実行中のまま
  await expect(page.getByText("調査に失敗しました")).toHaveCount(0);
  await expect(researchStep(page)).toContainText("(実行中)");

  await page.unroute(isServerAction);
  await page.getByRole("button", { name: "進捗を再確認" }).click();
  await expect(notice).toHaveCount(0, { timeout: 30_000 });
});
