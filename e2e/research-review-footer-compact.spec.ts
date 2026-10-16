import { expect, test, type Locator, type Page } from "@playwright/test";
import postgres from "postgres";
import { e2eDatabaseUrl } from "./support/e2e-db";

/**
 * 調査レビューの固定バーを、スマートフォン幅で 1 段にまとめる (#364)。
 *
 * 2 行の要約とボタン 2 つを縦に積んでいた頃は、固定バーが 163px あり、375×667 の画面の
 * 24% を占めていた。幅 640px 未満では要約を 1 行にし、副ボタンを「反映せずに完了」に縮めて
 * 主ボタンと横に並べる。640px 以上は従来の見た目のまま。
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

/**
 * 画面に見えている文言。副ボタンは幅ごとの文言を両方 DOM に持ち、片方を CSS で隠すので、
 * 非表示の文字まで拾う `toHaveText` では確かめられない。
 */
const visibleText = (locator: Locator) => locator.evaluate((el) => (el as HTMLElement).innerText.trim());

async function openReview(page: Page, storeId: string, viewport: { width: number; height: number }) {
  await page.setViewportSize(viewport);
  await page.goto(`/research/${storeId}`);
  await expect(footer(page)).toBeVisible();
}

/** 固定バーの中の、表示されている要素の矩形と、主ボタンの文言が欠けていないか。 */
async function measureFooter(page: Page) {
  return footer(page).evaluate((bar) => {
    const box = (el: Element) => {
      const r = el.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, height: r.height };
    };
    const buttons = Array.from(bar.querySelectorAll("button")).filter((b) => b.offsetParent !== null);
    const primary = buttons[buttons.length - 1]!;
    const row = primary.parentElement!;
    // 主ボタンを文言どおりの幅で描いたときの幅。複製を流れの外に置いて測る。
    const probe = primary.cloneNode(true) as HTMLElement;
    probe.style.cssText = "position:absolute;visibility:hidden;width:max-content;flex:none";
    row.appendChild(probe);
    const primaryNaturalWidth = probe.getBoundingClientRect().width;
    probe.remove();
    const gap = Number.parseFloat(getComputedStyle(row).columnGap) || 0;
    const skipWidth = buttons.length > 1 ? buttons[0]!.getBoundingClientRect().width : 0;
    return {
      bar: box(bar),
      viewportWidth: window.innerWidth,
      buttons: buttons.map((b) => ({ text: b.innerText, ...box(b) })),
      primaryClipped: primary.scrollWidth > primary.clientWidth + 1,
      /** 主ボタンが副ボタンの隣に文言どおりの幅で収まるか。収まらないときだけ折り返してよい。 */
      // ブラウザは 1/64px 単位で厳密に比べて折り返す (352px で 288.03 > 288 を実測)。余裕を持たせない。
      fitsInOneRow: skipWidth + gap + primaryNaturalWidth <= row.getBoundingClientRect().width,
      fitDetail: `${skipWidth}+${gap}+${primaryNaturalWidth} vs ${row.getBoundingClientRect().width}`,
    };
  });
}

test.describe("640px 未満", () => {
  test("375×667 で固定バーは 100px 以下、要約は 1 行、ボタンは横に並ぶ", async ({ page }) => {
    await openReview(page, MIXED.storeId, { width: 375, height: 667 });
    const bar = footer(page);

    await expect(bar.getByText("未対応 4（まとめて採用 2・1件ずつ確認 2）")).toBeVisible();
    await expect(bar.getByText("判断済み 0 ・ 未対応 4")).toBeHidden();

    const skip = bar.getByRole("button", { name: "残り4件は反映せずに完了", exact: true });
    await expect(skip).toBeVisible();
    expect(await visibleText(skip)).toBe("反映せずに完了");
    await expect(bar.getByRole("button", { name: "2件をまとめて採用" })).toBeVisible();

    const m = await measureFooter(page);
    expect(m.bar.height).toBeLessThanOrEqual(100);
    expect(m.buttons.map((b) => b.text)).toEqual(["反映せずに完了", "2件をまとめて採用"]);
    expect(Math.abs(m.buttons[0]!.top - m.buttons[1]!.top)).toBeLessThanOrEqual(1);
    for (const b of m.buttons) expect(b.height).toBeGreaterThanOrEqual(44);
    expect(m.primaryClipped).toBe(false);
  });

  // 主ボタンが副ボタンの隣に収まらない幅では、主ボタンを上の段へ折り返す。縮めると文言が欠ける
  // (実測では「2件をまとめて採用」も 344px 以下で収まらない)。折り返しは収まらないときだけ許す。
  for (const target of [MIXED, LONGEST]) {
    test(`幅 320〜639px のどこでも、はみ出さず、主ボタンの文言が欠けない (${target.storeId})`, async ({
      page,
    }) => {
      await openReview(page, target.storeId, { width: 639, height: 800 });
      if (target === LONGEST) {
        await expect(footer(page).getByRole("button", { name: "12件を採用して調査完了" })).toBeVisible();
      }
      const failures: string[] = [];
      const stackedWidths: number[] = [];
      for (let width = 320; width <= 639; width += 8) {
        await page.setViewportSize({ width, height: 800 });
        const m = await measureFooter(page);
        const [skip, primary] = m.buttons;
        if (m.buttons.length !== 2) failures.push(`${width}px: ボタンが ${m.buttons.length} 個`);
        const stacked = skip !== undefined && primary !== undefined && Math.abs(skip.top - primary.top) > 1;
        if (stacked) stackedWidths.push(width);
        if (stacked && m.fitsInOneRow) failures.push(`${width}px: 収まるのに 1 段に並ばない (${m.fitDetail})`);
        if (!stacked && !m.fitsInOneRow) failures.push(`${width}px: 収まらないのに折り返さない`);
        if (stacked && primary!.bottom > skip!.top) failures.push(`${width}px: 折り返した主ボタンが上の段にない`);
        if (m.buttons.some((b) => b.left < m.bar.left - 1 || b.right > m.bar.right + 1)) {
          failures.push(`${width}px: ボタンが固定バーからはみ出す`);
        }
        if (m.bar.right > m.viewportWidth + 1) failures.push(`${width}px: 固定バーが画面からはみ出す`);
        if (m.primaryClipped) failures.push(`${width}px: 主ボタンの文言が欠ける`);
        // 1 段なら、要約が 2 行に折り返しても 108px に収まる (#364 の見込み)。
        if (!stacked && m.bar.height > 108) failures.push(`${width}px: 固定バーが ${Math.round(m.bar.height)}px`);
      }
      expect(failures).toEqual([]);
      // 折り返すのは狭い端だけ。375px (iPhone SE) では 1 段に収まる。
      expect(stackedWidths.every((w) => w < 375)).toBe(true);
      test.info().annotations.push({ type: "stacked widths", description: stackedWidths.join(", ") || "なし" });
    });
  }
});

test("640px 以上は従来の見た目 (2 行の要約、件数入りの副ボタン)", async ({ page }) => {
  await openReview(page, MIXED.storeId, { width: 1117, height: 722 });
  const bar = footer(page);

  await expect(bar.getByText("判断済み 0 ・ 未対応 4")).toBeVisible();
  await expect(bar.getByText("まとめて採用: 2件（新規 2） ／ 1件ずつ確認: 推定 2")).toBeVisible();
  await expect(bar.getByText("未対応 4（まとめて採用 2・1件ずつ確認 2）")).toBeHidden();
  expect(await visibleText(bar.getByRole("button", { name: "残り4件は反映せずに完了", exact: true }))).toBe(
    "残り4件は反映せずに完了",
  );

  const m = await measureFooter(page);
  // #360 の時点で 61px。高さを増やさない。
  expect(m.bar.height).toBeLessThanOrEqual(61);
  // 640px 以上の副ボタンは高さ 32px、主ボタンは 36px (従来どおり)。縦の中心で揃っていれば 1 段。
  const center = (b: { top: number; height: number }) => b.top + b.height / 2;
  expect(Math.abs(center(m.buttons[0]!) - center(m.buttons[1]!))).toBeLessThanOrEqual(1);
});
