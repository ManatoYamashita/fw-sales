import { expect, test, type Page } from "@playwright/test";

/**
 * 店舗一覧の狭幅コンパクト表示 (#330)。
 *
 * body が `overflow-x: clip` なので、document の scrollWidth だけでは要素のはみ出しを
 * 見逃す。リスト内の要素の右端を座標で測る (`docs/architecture/responsive.md` §6)。
 */

const FILTERED_SORTED = "/stores?stage=%E6%9E%B6%E9%9B%BB%E6%B8%88%E3%81%BF&sort=next&dir=desc";

async function overflowingElements(page: Page) {
  return page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const list = document.querySelector('[role="list"][aria-label="店舗一覧 (コンパクト表示)"]');
    if (!list) return ["list not found"];
    const out: string[] = [];
    for (const el of list.querySelectorAll("*")) {
      const r = el.getBoundingClientRect();
      if (r.width <= 1 || r.height <= 1) continue; // sr-only
      if (r.right > vw + 0.5 || r.left < -0.5) out.push(`${el.tagName}:${Math.round(r.right)}`);
    }
    return out;
  });
}

test("375px では店舗を区切り線の行で並べ、横にはみ出さない", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 900 });
  await page.goto(FILTERED_SORTED);

  const list = page.getByRole("list", { name: "店舗一覧 (コンパクト表示)" });
  await expect(list).toBeVisible();
  await expect(page.locator("table")).toBeHidden();

  // トラットリア SOLE (store_005 / 受注 / 架電済み) は他の spec が書き換えない店舗。
  // 件数は並行する spec の書き込みで変わりうるので数えない。
  const row = list.getByRole("listitem").filter({ hasText: "トラットリア SOLE" });
  await expect(row).toHaveCount(1);
  // 表の列と同じ順: 店舗名 → 営業状態 → 次回アクション → 操作。
  const text = (await row.innerText()).replace(/\s+/g, " ");
  const at = (s: string) => text.indexOf(s);
  expect(at("トラットリア SOLE")).toBeGreaterThan(-1);
  expect(at("トラットリア SOLE")).toBeLessThan(at("受注"));
  expect(at("受注")).toBeLessThan(at("次回"));

  // 44px のタッチターゲット。
  const name = await row.getByRole("link", { name: "トラットリア SOLE", exact: true }).boundingBox();
  expect(name?.height).toBeGreaterThanOrEqual(44);
  const edit = await row.getByRole("link", { name: "トラットリア SOLE を編集" }).boundingBox();
  expect(edit?.height).toBeGreaterThanOrEqual(44);
  expect(edit?.width).toBeGreaterThanOrEqual(44);

  expect(await overflowingElements(page)).toEqual([]);
  const dims = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(dims.scrollWidth).toBeLessThanOrEqual(dims.clientWidth);
});

test("並び替えを解除すると絞り込みを残して既定の並びに戻る", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 900 });
  await page.goto(FILTERED_SORTED);

  const reset = page.getByRole("link", { name: "並び替えを解除 (既定の並び順に戻す)" });
  await expect(reset).toBeVisible();
  await reset.click();

  await expect(page).toHaveURL((url) => !url.searchParams.has("sort") && !url.searchParams.has("dir"));
  expect(new URL(page.url()).searchParams.get("stage")).toBe("架電済み");
  await expect(reset).toHaveCount(0);
  await expect(page.getByLabel("並び替えの基準")).toHaveValue("next");
});

test("幅を広げると同じ URL のまま表に切り替わる", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 900 });
  await page.goto(FILTERED_SORTED);
  await expect(page.getByRole("list", { name: "店舗一覧 (コンパクト表示)" })).toBeVisible();

  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(page.locator("table")).toBeVisible();
  await expect(page.getByRole("list", { name: "店舗一覧 (コンパクト表示)" })).toBeHidden();
  const url = new URL(page.url());
  expect(url.searchParams.get("sort")).toBe("next");
  expect(url.searchParams.get("dir")).toBe("desc");
  expect(url.searchParams.get("stage")).toBe("架電済み");
});
