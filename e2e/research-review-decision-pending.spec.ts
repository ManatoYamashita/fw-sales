import { expect, test, type Locator, type Page } from "@playwright/test";
import postgres from "postgres";
import { e2eDatabaseUrl } from "./support/e2e-db";

/**
 * 調査レビューの項目ごとの判断で、押したボタンだけが処理中になる (#337)。
 *
 * `scripts/e2e-setup.mjs` が store_005 に置くレビュー待ちの調査結果 (電話番号・営業時間・
 * 席数の 3 項目) を使う。判断は一度記録すると変えられないので、テストごとに別の項目を
 * 判断する。E2E を流し直すと準備処理が未判断へ戻す。
 *
 * 処理中の表示は応答が返るまでの短い間しか出ないため、判断の Server Action の送信を
 * 遅らせて観測する。
 */
const RESEARCH_PATH = "/research/store_005";
/** `scripts/e2e-setup.mjs` の `E2E_RESEARCH_RUN_ID`。 */
const RUN_ID = "run_e2e_review_pending";
const ACTION_DELAY_MS = 3_000;

// 同じ調査結果を順に判断していくので、並列にしない。後のテストは、先に判断した項目の
// ボタンが消えた画面を前提にしない書き方にしている。
test.describe.configure({ mode: "serial" });

// dev サーバは調査ページを初回アクセス時にコンパイルする。並列実行中は 30 秒の既定を
// 超えることがあるため、各テストの持ち時間を 3 倍にする (sales-status.spec.ts と同じ)。
test.beforeEach(() => {
  test.slow();
});

const sql = postgres(e2eDatabaseUrl(), { prepare: false, max: 1 });

test.afterAll(async () => {
  await sql.end();
});

/** この調査の、項目 `itemKey` についての判断の監査ログ。 */
const decideAuditRows = (itemKey: string) => sql`
  SELECT actor_user_id, payload FROM event_logs
  WHERE event = 'research.review.decide' AND target_id = ${RUN_ID} AND payload->>'itemKey' = ${itemKey}
`;

/** このページで送る Server Action (判断の記録) を `ms` だけ遅らせる。 */
async function delayServerActions(page: Page, ms: number): Promise<void> {
  await page.route(
    (url) => url.pathname === RESEARCH_PATH,
    async (route) => {
      const request = route.request();
      if (request.method() === "POST" && request.headers()["next-action"] !== undefined) {
        await new Promise((resolve) => setTimeout(resolve, ms));
      }
      await route.fallback();
    },
  );
}

/** 項目のカード。項目名は画面の別の欄 (店舗の基本情報) にも出るので、項目の key で探す。 */
const itemCard = (page: Page, key: string): Locator => page.locator(`#research-item-${key}`);

const busyButtons = (page: Page): Locator => page.locator('button[aria-busy="true"]');

// 処理中の表示は、判断の応答 (`ACTION_DELAY_MS` 遅らせる) の後の `router.refresh()` が
// 終わるまで続く。完了を待つときは処理中が消えるのを長めに待ち、その後で結果を確かめる。
const REFRESH_TIMEOUT_MS = 30_000;

/** 押したボタンが処理中で、ほかの項目のボタンは処理中にならず押せないだけであること。 */
async function expectOnlyPressedIsBusy(page: Page, pressed: Locator, others: Locator[]): Promise<void> {
  await expect(pressed).toHaveAttribute("aria-busy", "true");
  await expect(pressed).toBeDisabled();
  await expect(pressed.locator('[data-slot="button-spinner"]')).toBeVisible();
  await expect(busyButtons(page)).toHaveCount(1);
  for (const other of others) {
    await expect(other).toBeDisabled();
    await expect(other).not.toHaveAttribute("aria-busy", "true");
  }
}

test.beforeEach(async ({ page }) => {
  await delayServerActions(page, ACTION_DELAY_MS);
  await page.goto(RESEARCH_PATH);
  await expect(itemCard(page, "phone")).toBeVisible();
});

test("「却下」を押すと、そのボタンだけが処理中になり、完了すると全ボタンが戻る", async ({ page }) => {
  const phone = itemCard(page, "phone");
  const seats = itemCard(page, "seat_count");
  const reject = phone.getByRole("button", { name: "却下", exact: true });

  await reject.click();

  await expectOnlyPressedIsBusy(page, reject, [
    phone.getByRole("button", { name: "採用", exact: true }),
    phone.getByRole("button", { name: "スキップ", exact: true }),
    seats.getByRole("button", { name: "却下", exact: true }),
    page.getByRole("button", { name: "候補Bを採用" }),
  ]);

  await expect(busyButtons(page)).toHaveCount(0, { timeout: REFRESH_TIMEOUT_MS });
  await expect(phone.locator("summary")).toContainText("却下済み");
  await expect(seats.getByRole("button", { name: "却下", exact: true })).toBeEnabled();
  await expect(page.getByRole("button", { name: "候補Bを採用" })).toBeEnabled();

  // 判断は監査ログにも残る。E2E ユーザーの ID が監査の検証を通らないと、判断は成功した
  // まま監査の書き込みだけが失敗する (#346)。書き込みは応答の後なので、残るまで待つ。
  await expect.poll(async () => (await decideAuditRows("phone")).length).toBe(1);
  const [row] = await decideAuditRows("phone");
  expect(row!.actor_user_id).not.toBeNull();
  expect(row!.payload).toEqual({ itemKey: "phone", decision: "rejected" });
});

test("候補を選ぶ項目では、押した候補のボタンだけが処理中になる", async ({ page }) => {
  const hours = itemCard(page, "business_hours_holidays");
  const candidateB = hours.getByRole("button", { name: "候補Bを採用" });

  await candidateB.click();

  await expectOnlyPressedIsBusy(page, candidateB, [
    hours.getByRole("button", { name: "候補Aを採用" }),
    itemCard(page, "seat_count").getByRole("button", { name: "採用", exact: true }),
  ]);

  await expect(busyButtons(page)).toHaveCount(0, { timeout: REFRESH_TIMEOUT_MS });
  await expect(hours.locator("summary")).toContainText("採用済み");
});

test("「編集内容で採用」は、処理中も編集欄を残して読み取り専用にし、完了後に閉じる", async ({ page }) => {
  const seats = itemCard(page, "seat_count");
  await seats.getByRole("button", { name: "編集して採用" }).click();
  const editor = seats.getByRole("textbox", { name: "席数 編集値" });
  await editor.fill("24席");
  const submit = seats.getByRole("button", { name: "編集内容で採用" });

  await submit.click();

  await expectOnlyPressedIsBusy(page, submit, [seats.getByRole("button", { name: "キャンセル" })]);
  // 押した瞬間に編集欄を閉じると、処理中を示すボタンごと消える。残して、打てないようにする。
  await expect(editor).toBeVisible();
  await expect(editor).toHaveValue("24席");
  await expect(editor).not.toBeEditable();
  // 「採用」と「編集内容で採用」は別のボタン。処理中に「採用」の列へ戻らない。
  await expect(seats.getByRole("button", { name: "採用", exact: true })).toHaveCount(0);

  await expect(busyButtons(page)).toHaveCount(0, { timeout: REFRESH_TIMEOUT_MS });
  await expect(seats.locator("summary")).toContainText("採用済み");
  await expect(editor).toHaveCount(0);
});
