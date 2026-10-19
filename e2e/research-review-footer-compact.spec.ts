import { expect, test, type Locator, type Page } from "@playwright/test";
import postgres from "postgres";
import { e2eDatabaseUrl } from "./support/e2e-db";

/**
 * 調査レビューの固定バーを、スマートフォン幅でコンパクトに保つ (#364, #378)。
 *
 * 2 行の要約とボタン 2 つを縦に積んでいた頃は、固定バーが 163px あり、375×667 の画面の
 * 24% を占めていた。#378 では主操作を常に表示し、内訳・副操作を明示的な開閉へ移した。
 * 切り替えはサイドバーを含む実効コンテナ幅で判定し、低い画面では固定を解除する。
 *
 * レイアウトは SSR のテストでは測れないため、実ブラウザで幅を変えて確かめる。
 * ほかの spec が判断を記録する store_005 の調査結果とは別に、seed の店舗を複製した専用の
 * 店舗と調査結果を作り、最後に消す (`store-basic-info-inline-edit.spec.ts` と同じ方式)。
 * このファイルは画面を読むだけで、判断も完了も押さない。
 */

// 店舗の作成と削除を beforeAll / afterAll で行うため、直列で流す。並列だとワーカーごとに
// 走る afterAll が、別のワーカーが開いている最中の店舗を消して 404 になる。
test.describe.configure({ mode: "serial" });

// dev サーバは調査ページを初回アクセス時にコンパイルする。
test.beforeEach(() => {
  test.slow();
});

/** 確認済み 2・推定 2。主ボタンは「2件をまとめて採用」、副ボタンが出る。 */
const MIXED = { storeId: "store_e2e_364", runId: "run_e2e_364_mixed" };
/** 確認済み 12 だけ。主ボタンの文言がいちばん長い「12件を採用して調査完了」になる。 */
const LONGEST = { storeId: "store_e2e_364_long", runId: "run_e2e_364_long" };

const confirmed = (key: string) => ({
  key,
  research_policy: "FACT",
  status: "confirmed",
  value: `E2E の値 ${key}`,
  evidence: "E2E 用の確認済みの値です。",
  source_ids: [],
});
const inferred = (key: string) => ({ ...confirmed(key), status: "inferred" });

const MIXED_ITEMS = [confirmed("phone"), confirmed("seat_count"), inferred("main_target"), inferred("concept")];
const LONGEST_ITEMS = [
  "store_name",
  "address",
  "opening_date",
  "business_hours_holidays",
  "average_spend_day_night",
  "seat_count",
  "cuisine_genre",
  "concept",
  "signature_food_drink",
  "exterior_interior",
  "alacarte_course",
  "phone",
].map(confirmed);

const sql = postgres(e2eDatabaseUrl(), { prepare: false, max: 1 });

async function createStoreWithRun(
  { storeId, runId }: { storeId: string; runId: string },
  items: unknown[],
): Promise<void> {
  await sql`DELETE FROM stores WHERE id = ${storeId}`;
  await sql.begin(async (tx) => {
    await tx`CREATE TEMP TABLE e2e_store ON COMMIT DROP AS SELECT * FROM stores WHERE id = 'store_005'`;
    // 基本情報が空なら、確認済みの値は「新規」として主ボタンのまとめて採用に入る。
    await tx`UPDATE e2e_store SET id = ${storeId}, name = ${`E2E固定バー ${storeId}`}, basic_info = '{}'::jsonb`;
    await tx`INSERT INTO stores SELECT * FROM e2e_store`;
  });
  const now = new Date().toISOString();
  await sql`
    INSERT INTO store_research_runs (
      id, store_id, requested_by_user_id, status, stage, result, source_registry,
      review_decisions, review_completed_at, warnings, started_at, expires_at, finished_at
    )
    VALUES (
      ${runId}, ${storeId}, ${null}, ${"succeeded"}, ${"done"},
      ${JSON.stringify(items)}::jsonb, ${"[]"}::jsonb, ${"{}"}::jsonb, ${null},
      ${"[]"}::jsonb, ${now}, ${now}, ${now}
    )
  `;
}

test.beforeAll(async () => {
  await createStoreWithRun(MIXED, MIXED_ITEMS);
  await createStoreWithRun(LONGEST, LONGEST_ITEMS);
});

test.afterAll(async () => {
  // 調査結果は店舗の削除で cascade される。
  await sql`DELETE FROM stores WHERE id IN (${MIXED.storeId}, ${LONGEST.storeId})`;
  await sql.end();
});

const footer = (page: Page): Locator => page.getByRole("region", { name: "レビュー完了操作" });

async function openReview(page: Page, storeId: string, viewport: { width: number; height: number }) {
  await page.setViewportSize(viewport);
  // 外部の埋め込み地図の load を待たず、対象の操作欄の描画を条件にする。
  await page.goto(`/research/${storeId}`, { waitUntil: "domcontentloaded" });
  await expect(footer(page)).toBeVisible();
}

/** 非表示の幅別レイアウトや、閉じた details の中身は計測しない。 */
async function measureFooter(page: Page) {
  return footer(page).evaluate((bar) => {
    const box = (el: Element) => {
      const r = el.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, height: r.height };
    };
    const buttons = Array.from(bar.querySelectorAll("button")).filter((b) => b.checkVisibility());
    return {
      bar: box(bar),
      viewportWidth: window.innerWidth,
      position: getComputedStyle(bar).position,
      buttons: buttons.map((b) => ({
        text: b.innerText,
        clipped: b.scrollWidth > b.clientWidth + 1,
        ...box(b),
      })),
    };
  });
}

test("375×667 は主操作と開閉見出しを表示し、内訳・副操作は開いて選べる", async ({ page }) => {
  await openReview(page, MIXED.storeId, { width: 375, height: 667 });
  const bar = footer(page);
  const skip = bar.getByRole("button", { name: "残り4件は反映せずに完了", exact: true });
  const summary = bar.locator("summary");

  await expect(bar.getByRole("button", { name: "2件をまとめて採用" })).toBeVisible();
  await expect(summary).toContainText("判断済み 0 ・ 未対応 4");
  await expect(summary).toContainText("内訳・完了方法");
  await expect(skip).toBeHidden();
  const closed = await measureFooter(page);
  expect(closed.bar.height).toBeLessThanOrEqual(124);
  expect(closed.buttons).toHaveLength(1);
  expect(closed.buttons[0]!.height).toBeGreaterThanOrEqual(44);

  await summary.focus();
  await page.keyboard.press("Enter");
  await expect(skip).toBeVisible();
  await expect(bar.getByText("まとめて採用: 2件（新規 2） ／ 1件ずつ確認: 推定 2").last()).toBeVisible();
  const opened = await measureFooter(page);
  expect(opened.buttons).toHaveLength(2);
  for (const button of opened.buttons) {
    expect(button.height).toBeGreaterThanOrEqual(44);
    expect(button.clipped).toBe(false);
  }
});

for (const target of [MIXED, LONGEST]) {
  test(`幅 320〜639px で主操作と開いた副操作が欠けない (${target.storeId})`, async ({ page }) => {
    await openReview(page, target.storeId, { width: 639, height: 800 });
    const bar = footer(page);
    const primaryLabel = target === LONGEST ? "12件を採用して調査完了" : "2件をまとめて採用";
    await expect(bar.getByRole("button", { name: primaryLabel, exact: true })).toBeVisible();
    const failures: string[] = [];
    for (let width = 320; width <= 639; width += 8) {
      await page.setViewportSize({ width, height: 800 });
      for (const opened of [false, true]) {
        await bar.locator("details").evaluate((el, open) => { (el as HTMLDetailsElement).open = open; }, opened);
        const m = await measureFooter(page);
        if (m.buttons.length !== (opened ? 2 : 1)) failures.push(`${width}px: 表示中の操作数が不正`);
        if (m.buttons.some((b) => b.left < m.bar.left - 1 || b.right > m.bar.right + 1 || b.clipped)) {
          failures.push(`${width}px: 操作が欠ける (open=${opened})`);
        }
        if (m.bar.right > m.viewportWidth + 1) failures.push(`${width}px: 固定バーが画面からはみ出す`);
        if (!opened && m.bar.height > 124) failures.push(`${width}px: 固定バーが ${m.bar.height}px`);
      }
    }
    expect(failures).toEqual([]);
  });
}

test("広いコンテナでは内訳と両方の完了操作を常に表示する", async ({ page }) => {
  await openReview(page, MIXED.storeId, { width: 1117, height: 722 });
  const bar = footer(page);
  await expect(bar.locator("summary")).toBeHidden();
  await expect(bar.getByText("判断済み 0 ・ 未対応 4").first()).toBeVisible();
  await expect(bar.getByText("まとめて採用: 2件（新規 2） ／ 1件ずつ確認: 推定 2").first()).toBeVisible();
  await expect(bar.getByRole("button", { name: "残り4件は反映せずに完了", exact: true })).toBeVisible();

  const m = await measureFooter(page);
  expect(m.bar.height).toBeLessThanOrEqual(100);
  expect(m.buttons).toHaveLength(2);
  for (const button of m.buttons) {
    expect(button.height).toBeGreaterThanOrEqual(44);
    expect(button.clipped).toBe(false);
  }
  expect(Math.abs(m.buttons[0]!.top - m.buttons[1]!.top)).toBeLessThanOrEqual(1);
});

test("高さ330pxでは固定を解除し、ページ末尾から操作できる", async ({ page }) => {
  await openReview(page, MIXED.storeId, { width: 375, height: 330 });
  const bar = footer(page);
  expect((await measureFooter(page)).position).toBe("static");
  await bar.scrollIntoViewIfNeeded();
  await expect(bar.getByRole("button", { name: "2件をまとめて採用" })).toBeInViewport();
  await bar.locator("summary").click();
  const skip = bar.getByRole("button", { name: "残り4件は反映せずに完了", exact: true });
  await skip.scrollIntoViewIfNeeded();
  await expect(skip).toBeInViewport();
});
