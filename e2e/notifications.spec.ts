import { execFileSync } from "node:child_process";
import { expect, test, type Page, type Request } from "@playwright/test";
import postgres from "postgres";

/**
 * 通知ベルの既読化 (#296)。
 *
 * 固定データは scripts/e2e-setup.mjs の ensureE2eNotifications が投入する
 * (未読 3 件 = 実在店舗 / 削除済み店舗 / リンク無し、既読 1 件)。
 * 既読状態を順に変えていくため、1 本のシナリオとして直列に確かめる。
 */

// 追加の通知が既存シナリオの未読件数へ混ざらないよう、同じファイル内で直列に流す。
test.describe.configure({ mode: "serial" });

let sql: ReturnType<typeof postgres>;

test.beforeAll(() => {
  let databaseUrl = process.env.E2E_DATABASE_URL;
  if (!databaseUrl) {
    const name = process.env.E2E_DB_CONTAINER?.trim() || "fw-sales-e2e-postgres";
    const containers = JSON.parse(
      execFileSync("container", ["list", "--all", "--format", "json"], { encoding: "utf8" }),
    ) as Array<{ id: string; status?: { networks?: Array<{ ipv4Address?: string }> } }>;
    const address = containers.find((c) => c.id === name)?.status?.networks?.[0]?.ipv4Address;
    if (!address) throw new Error(`E2E用PostgreSQLコンテナ「${name}」の内部IPを取得できませんでした。`);
    databaseUrl = `postgres://postgres:postgres@${address.split("/")[0]}:5432/postgres`;
  }
  sql = postgres(databaseUrl, { prepare: false, max: 1 });
});

test.afterEach(async () => {
  await sql`DELETE FROM notifications WHERE id LIKE 'notif_e2e_351_%'`;
});

test.afterAll(async () => {
  await sql.end();
});

async function createLinkedNotification(id: string, readAt: string | null = null) {
  const title = `E2E: 既読保存の確認 ${id}`;
  const now = new Date().toISOString();
  const rows = await sql`INSERT INTO notifications
    (id, user_id, kind, title, body, link_url, read_at, created_at, updated_at)
    SELECT ${id}, id, 'research_job_completed', ${title}, '既読保存と遷移を確認します',
      '/stores/store_001', ${readAt}, ${now}, ${now}
    FROM profiles WHERE email = ${process.env.E2E_TEST_EMAIL?.trim() || "e2e@example.test"}
    RETURNING id`;
  expect(rows).toHaveLength(1);
  return title;
}

function isReadAction(request: Request, id: string) {
  return request.method() === "POST" &&
    request.headers()["next-action"] !== undefined &&
    (request.postData() ?? "").includes(id);
}

async function savedReadAt(id: string) {
  const [notification] = await sql`SELECT read_at FROM notifications WHERE id = ${id}`;
  return notification?.read_at ?? null;
}

async function openFixtureStores(page: Page) {
  // SQL で投入した fixture はタグを失効させないため、最初の読込だけ dev の
  // hard refresh と同じにする。クリック以降は通常のキャッシュで保存・遷移を検証する。
  await page.setExtraHTTPHeaders({ "Cache-Control": "no-cache" });
  await page.goto("/stores");
  await page.setExtraHTTPHeaders({});
}

function bell(page: Page) {
  return page.locator("header").getByRole("button", { name: /^通知 \(/ });
}

/**
 * 本文に通知 ID を含む既読化の Server Action の応答を待つ。
 *
 * 既読化は表示を楽観的に変える。リンクの通知は保存後に遷移する (#351) が、
 * リンクのない通知はクリック後もその場に残るため、再読込の前に保存完了を待つ。
 */
function waitForMarkRead(page: Page, notificationId: string) {
  return page.waitForResponse(
    (res) =>
      res.request().method() === "POST" &&
      res.request().headers()["next-action"] !== undefined &&
      (res.request().postData() ?? "").includes(notificationId),
    { timeout: 60_000 },
  );
}

async function openPanel(page: Page) {
  await bell(page).click();
  const panel = page.getByRole("dialog", { name: "通知一覧" });
  await expect(panel).toBeVisible();
  return panel;
}

test("通知はクリックで既読になり、削除済み店舗へは遷移せず、一括既読もできる", async ({
  page,
}) => {
  // dev サーバは店舗詳細や Server Action を初回呼び出し時にコンパイルする。
  // 1 本のシナリオで複数の初回コンパイルを踏むため、既定の 30 秒では足りないことがある。
  test.slow();
  await page.goto("/stores");
  await expect(bell(page)).toHaveAccessibleName("通知 (3 件未読)");

  // 削除済み店舗を指す通知: リンクにならず、クリックしても 404 画面へ飛ばない
  let panel = await openPanel(page);
  const dead = panel.getByRole("button", {
    name: "未読: E2E: 削除済み店舗の通知",
  });
  await expect(dead).toBeVisible();
  await expect(panel.locator('a[href*="store_e2e_deleted"]')).toHaveCount(0);
  const deadRead = waitForMarkRead(page, "notif_e2e_dead");
  await dead.click();
  await expect(page).toHaveURL(/\/stores$/);
  await expect(bell(page)).toHaveAccessibleName("通知 (2 件未読)");
  await expect(
    panel.getByRole("button", { name: "E2E: 削除済み店舗の通知" }),
  ).toBeVisible();

  // 実在店舗を指す通知: 遷移し、既読になる
  const aliveRead = waitForMarkRead(page, "notif_e2e_alive");
  await panel
    .getByRole("link", { name: "未読: E2E: 導楽の調査が完了しました" })
    .click();
  // 初回は /stores/[id] のコンパイルを待つ (既定の 5 秒では遷移前に判定が終わる)
  await expect(page).toHaveURL(/\/stores\/store_001$/, { timeout: 30_000 });
  await expect(page.getByText("指定された店舗は見つかりませんでした")).toHaveCount(0);
  await expect(bell(page)).toHaveAccessibleName("通知 (1 件未読)");

  // 既読はサーバーへ保存されている (再読込しても戻らない)
  await deadRead;
  await aliveRead;
  await expect(async () => {
    await page.reload();
    await expect(bell(page)).toHaveAccessibleName("通知 (1 件未読)", {
      timeout: 2_000,
    });
  }).toPass();

  // 一括既読
  panel = await openPanel(page);
  // 表示は楽観的に 0 件へ変わるので、再読込の前に保存 (Server Action) の完了を待つ。
  // 待たずに reload すると、初回コンパイル中の Action リクエストが捨てられて未読が戻る。
  // 引数の無い Action で要求の本文からは特定できないため、応答の結果 ({ count }) で見分ける
  // (ページ読み込み時の getSessionRoleAction も引数無しの POST を投げる)。
  const markedAll = page.waitForResponse(
    async (res) =>
      res.request().method() === "POST" &&
      res.request().headers()["next-action"] !== undefined &&
      (await res.text()).includes('"count"'),
    { timeout: 60_000 },
  );
  await panel.getByRole("button", { name: "すべて既読にする" }).click();
  await markedAll;
  await expect(bell(page)).toHaveAccessibleName("通知 (0 件未読)");
  await expect(panel.getByText("未読なし")).toBeVisible();
  await expect(
    panel.getByRole("button", { name: "すべて既読にする" }),
  ).toHaveCount(0);

  await expect(async () => {
    await page.reload();
    await expect(bell(page)).toHaveAccessibleName("通知 (0 件未読)", {
      timeout: 2_000,
    });
  }).toPass();
});

test("通知の既読保存が完了するまで遷移せず、遷移直後の再読込でも既読を保持する", async ({ page }) => {
  test.slow();
  const id = "notif_e2e_351_delayed";
  const title = await createLinkedNotification(id);
  await openFixtureStores(page);
  const panel = await openPanel(page);
  const link = panel.getByRole("link", { name: `未読: ${title}`, exact: true });

  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  let requests = 0;
  let navigations = 0;
  page.on("request", (request) => {
    if (request.method() === "GET" && new URL(request.url()).pathname === "/stores/store_001") {
      navigations += 1;
    }
  });
  await page.route("**/stores**", async (route) => {
    if (isReadAction(route.request(), id)) {
      requests += 1;
      await held;
    }
    await route.continue();
  });

  try {
    const marking = page.waitForRequest((request) => isReadAction(request, id), { timeout: 60_000 });
    await link.click();
    await marking;
    expect(navigations, "保存を止めている間は遷移先の読み込みを開始しない").toBe(0);
    await expect(page).toHaveURL(/\/stores$/);
    expect(navigations).toBe(0);
    // 保存中もパネルを残し、楽観更新後の再クリックでは保存や遷移を重複させない。
    const pending = panel.getByRole("link", { name: title, exact: true });
    await expect(pending).toHaveAttribute("aria-busy", "true");
    expect(await savedReadAt(id)).toBeNull();
    await pending.click();
    expect(requests).toBe(1);
    await expect(page).toHaveURL(/\/stores$/);

    release();
    await expect(page).toHaveURL(/\/stores\/store_001$/, { timeout: 30_000 });
    // 楽観表示や応答だけでなく、遷移時点で実 DB に保存済みであることを確かめる。
    expect(await savedReadAt(id)).not.toBeNull();
    await page.reload();
    const reloaded = await openPanel(page);
    await expect(reloaded.getByRole("link", { name: title, exact: true })).toBeVisible();
    await expect(reloaded.getByRole("link", { name: `未読: ${title}`, exact: true })).toHaveCount(0);
  } finally {
    release();
  }
});

test("既読保存に失敗した通知は遷移せず未読に戻り、再試行で既読になる", async ({ page }) => {
  test.slow();
  const id = "notif_e2e_351_retry";
  const title = await createLinkedNotification(id);
  await openFixtureStores(page);
  const panel = await openPanel(page);
  let rejected = false;
  await page.route("**/stores**", async (route) => {
    if (!rejected && isReadAction(route.request(), id)) {
      rejected = true;
      await route.abort("failed");
      return;
    }
    await route.continue();
  });

  const link = panel.getByRole("link", { name: `未読: ${title}`, exact: true });
  await link.click();
  await expect(page.getByRole("region", { name: "通知", exact: true }).getByRole("alert"))
    .toContainText("処理を完了できませんでした");
  await expect(link).toBeVisible();
  await expect(link).not.toHaveAttribute("aria-busy", "true");
  await expect(page).toHaveURL(/\/stores$/);
  expect(await savedReadAt(id)).toBeNull();

  // キーボードによる再試行も、保存が終わってから遷移する。
  await link.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/stores\/store_001$/, { timeout: 30_000 });
  expect(await savedReadAt(id)).not.toBeNull();
});

test("既読の通知は保存を再送せずにリンク先へ遷移できる", async ({ page }) => {
  test.slow();
  const id = "notif_e2e_351_already_read";
  const readAt = new Date().toISOString();
  const title = await createLinkedNotification(id, readAt);
  await openFixtureStores(page);
  const panel = await openPanel(page);
  let requests = 0;
  page.on("request", (request) => {
    if (isReadAction(request, id)) requests += 1;
  });
  await panel.getByRole("link", { name: title, exact: true }).click();
  await expect(page).toHaveURL(/\/stores\/store_001$/, { timeout: 30_000 });
  expect(requests).toBe(0);
  expect(await savedReadAt(id)).toBe(readAt);
});

test("通知の別タブへのリンク操作を保ち、元の画面で既読を保存する", async ({ page }) => {
  test.slow();
  const id = "notif_e2e_351_new_tab";
  const title = await createLinkedNotification(id);
  await openFixtureStores(page);
  const panel = await openPanel(page);
  const opened = page.context().waitForEvent("page");
  await panel.getByRole("link", { name: `未読: ${title}`, exact: true }).click({ modifiers: ["ControlOrMeta"] });
  const popup = await opened;
  try {
    await expect(popup).toHaveURL(/\/stores\/store_001$/, { timeout: 30_000 });
    await expect(page).toHaveURL(/\/stores$/);
    await expect.poll(() => savedReadAt(id)).not.toBeNull();
  } finally {
    await popup.close();
  }
});
