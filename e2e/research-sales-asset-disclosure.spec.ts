import { expect, test, type Page } from "@playwright/test";

/**
 * `/research/[storeId]` の「③ 営業資産を生成」の開閉 (#322)。
 *
 * seed の店舗は AI 調査の run を持たない (= ① 未着手) ので、③ は閉じて始まる。
 * レビュー完了済みで開いて始まる側は `lib/domain/__tests__/research-flow.test.ts` と
 * `sales-asset-section-render.test.tsx` が固定する。
 *
 * どのテストも DB を書き換えない (生成ボタンは押さない)。他の spec が書き換える
 * store_002 / store_004 は避け、store_001 を読むだけにする。
 */
const RESEARCH_URL = "/research/store_001";

// dev サーバは調査ページを初回アクセス時にコンパイルする。並列実行中は 30 秒の既定を
// 超えることがあるため、各テストの持ち時間を 3 倍にする (sales-status.spec.ts と同じ)。
test.beforeEach(() => {
  test.slow();
});

const toggle = (page: Page) => page.getByRole("button", { name: "③ 営業資産を生成" });
const supplement = (page: Page) => page.getByRole("textbox", { name: "補足情報(任意)" });

test("① ② が未完了なら ③ は閉じて始まり、本文の操作へフォーカスが入らない", async ({ page }) => {
  await page.goto(RESEARCH_URL);

  await expect(toggle(page)).toHaveAttribute("aria-expanded", "false");
  await expect(toggle(page)).toHaveAttribute("aria-controls", "sales-assets-body");
  await expect(page.locator("#sales-assets-body")).toBeHidden();
  await expect(supplement(page)).toBeHidden();
  // 見出し行 (件数) は閉じていても見える。
  await expect(page.getByText(/基本情報 \d+ \/ \d+ 件を使用/)).toBeVisible();

  // 開閉ボタンの次の Tab で、閉じた本文の中へ入らない。
  await toggle(page).focus();
  await page.keyboard.press("Tab");
  const focusedInsideBody = await page.evaluate(
    () => document.getElementById("sales-assets-body")?.contains(document.activeElement) ?? false,
  );
  expect(focusedInsideBody).toBe(false);
});

test("キーボードで開閉でき、閉じても入力中の補足情報・追加指示は失われない", async ({ page }) => {
  await page.goto(RESEARCH_URL);

  await toggle(page).focus();
  await page.keyboard.press("Enter");
  await expect(toggle(page)).toHaveAttribute("aria-expanded", "true");
  await expect(supplement(page)).toBeVisible();

  // ①② を飛ばしても生成できる (ボタンは押せる状態で、飛ばす手順をラベルに書く)。
  const generate = page.getByRole("button", { name: "AI調査をせずに生成" });
  await expect(generate).toBeVisible();
  await expect(generate).toBeEnabled();

  await supplement(page).fill("電話で聞いた: 平日 14 時以降が空いている");
  await page.getByText("生成への追加指示(任意)").click();
  const instructions = page.getByRole("textbox", { name: "生成への追加指示" });
  await instructions.fill("短めに");

  await toggle(page).focus();
  await page.keyboard.press("Space");
  await expect(toggle(page)).toHaveAttribute("aria-expanded", "false");
  await expect(supplement(page)).toBeHidden();

  await toggle(page).click();
  await expect(toggle(page)).toHaveAttribute("aria-expanded", "true");
  await expect(supplement(page)).toHaveValue("電話で聞いた: 平日 14 時以降が空いている");
  await expect(instructions).toHaveValue("短めに");
});

test("#sales-assets へのリンクで来たら、① ② が未完了でも開いた状態で着地する", async ({ page }) => {
  await page.goto(`${RESEARCH_URL}#sales-assets`);

  await expect(toggle(page)).toHaveAttribute("aria-expanded", "true");
  await expect(supplement(page)).toBeVisible();
  await expect(page.locator("#sales-assets")).toBeInViewport();

  // 利用者が閉じればそれに従う (ハッシュが残っていても開き直さない)。
  await toggle(page).click();
  await expect(toggle(page)).toHaveAttribute("aria-expanded", "false");
  await expect(supplement(page)).toBeHidden();
});
