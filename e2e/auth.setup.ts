import fs from "node:fs/promises";
import path from "node:path";
import { expect, test as setup } from "@playwright/test";

const authFile = path.resolve("playwright/.auth/user.json");

setup("ローカルE2Eユーザーで認証状態を作る", async ({ request }) => {
  const response = await request.get("/api/e2e/login?redirect=/stores");
  expect(response.ok()).toBeTruthy();
  await fs.mkdir(path.dirname(authFile), { recursive: true });
  await request.storageState({ path: authFile });
});
