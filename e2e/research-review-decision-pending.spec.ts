import { FIRSTWEB_TENANT_ID } from "../lib/tenant/id";
import { expect, test, type Locator, type Page } from "@playwright/test";
import postgres from "postgres";
import { e2eDatabaseUrl } from "./support/e2e-db";
import { refreshServerCache } from "./support/fresh-cache";

/**
 * 調査レビューの項目ごとの判断で、押したボタンだけが処理中になる (#337)。
 *
 * store_005 にレビュー待ちの調査結果 (電話番号・営業時間・席数の 3 項目) を置いて使う。
 * 判断は一度記録すると変えられないので、テストごとに別の項目を判断する。CI の retry でも
 * 未判断から始められるよう、`beforeAll` で毎回作り直す (#390)。
 *
 * 処理中の表示は応答が返るまでの短い間しか出ないため、判断の Server Action の送信を
 * 遅らせて観測する。
 */
const STORE_ID = "store_005";
const RESEARCH_PATH = `/research/${STORE_ID}`;
const RUN_ID = "run_e2e_review_pending";
const ACTION_DELAY_MS = 3_000;

/**
 * レビュー待ちの調査結果。どの項目も個別に判断する欄 (individual / choose) に入るよう、
 * 基本情報が空の店舗に推測 (inferred) と競合 (conflict) だけを置く。
 */
const REVIEW_ITEMS = [
  {
    key: "phone",
    research_policy: "FACT",
    status: "inferred",
    value: "03-0000-0001",
    evidence: "E2E 用の推測値です。",
    source_ids: [],
  },
  {
    key: "business_hours_holidays",
    research_policy: "FACT",
    status: "conflict",
    value: null,
    evidence: "E2E 用の競合です。",
    source_ids: [],
    candidates: [
      { candidate_id: "cand_a", label: "公式サイト", value: "11:30-22:00 / 月曜定休", evidence: "E2E 候補A", source_ids: [] },
      { candidate_id: "cand_b", label: "Google Places", value: "11:00-23:00 / 無休", evidence: "E2E 候補B", source_ids: [] },
    ],
  },
  {
    key: "seat_count",
    research_policy: "FACT",
    status: "inferred",
    value: "20席",
    evidence: "E2E 用の推測値です。",
    source_ids: [],
  },
];

// 同じ調査結果を順に判断していくので、並列にしない。後のテストは、先に判断した項目の
// ボタンが消えた画面を前提にしない書き方にしている。
test.describe.configure({ mode: "serial" });

// dev サーバは調査ページを初回アクセス時にコンパイルする。並列実行中は 30 秒の既定を
// 超えることがあるため、各テストの持ち時間を 3 倍にする (sales-status.spec.ts と同じ)。
test.beforeEach(() => {
  test.slow();
});

const sql = postgres(e2eDatabaseUrl(), { prepare: false, max: 1 });

test.beforeAll(async ({}, testInfo) => {
  await sql`DELETE FROM store_research_runs WHERE store_id = ${STORE_ID}`;
  // 判断の監査ログは件数を確かめるので、前の試行で残った分も消す。
  await sql`DELETE FROM event_logs WHERE target_id = ${RUN_ID}`;
  // 採用した値が残っていると「上書き」の言い換えに変わるので、基本情報も空に戻す。
  await sql`UPDATE stores SET basic_info = '{}'::jsonb WHERE id = ${STORE_ID}`;
  const now = new Date();
  const startedAt = new Date(now.getTime() - 10 * 60 * 1000).toISOString();
  await sql`
    INSERT INTO store_research_runs (
      id, tenant_id, store_id, requested_by_user_id, status, stage, result, source_registry,
      review_decisions, review_completed_at, warnings, started_at, expires_at, finished_at
    )
    VALUES (
      ${RUN_ID}, ${FIRSTWEB_TENANT_ID}, ${STORE_ID}, ${null}, ${"succeeded"}, ${"done"},
      ${JSON.stringify(REVIEW_ITEMS)}::jsonb, ${"[]"}::jsonb, ${"{}"}::jsonb, ${null},
      ${"[]"}::jsonb, ${startedAt}, ${now.toISOString()}, ${now.toISOString()}
    )
  `;
  // 店舗の基本情報は 'use cache' で読むので、空に戻した値を画面にも出させる。
  await refreshServerCache(testInfo, [RESEARCH_PATH]);
});

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

/**
 * 項目のカードの見出し。カードの中には「根拠・出典を確認」(#378) や未確認の情報源の
 * 開閉が `<details>` で入れ子になるので、カード直下の summary に絞る。
 */
const itemSummary = (card: Locator): Locator => card.locator(":scope > summary");

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
  await expect(itemSummary(phone)).toContainText("却下済み");
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
  await expect(itemSummary(hours)).toContainText("採用済み");
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
  await expect(itemSummary(seats)).toContainText("採用済み");
  await expect(editor).toHaveCount(0);
});
