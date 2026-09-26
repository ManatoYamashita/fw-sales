import { defineConfig, devices } from "@playwright/test";

const port = Number.parseInt(process.env.E2E_PORT ?? "3100", 10);
const baseURL = `http://127.0.0.1:${port}`;
const e2eSecret = process.env.E2E_TEST_SECRET ?? "local-e2e-only";
const authFile = "playwright/.auth/user.json";

// ローカルでは付属 Chromium の代わりにインストール済みの Chromium 系ブラウザを使える。
// CI では結果の再現性を保つため、この上書きを無視して常に付属 Chromium を使う。
const chromiumExecutablePath = process.env.CI
  ? undefined
  : process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?.trim() || undefined;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "line" : "html",
  use: {
    baseURL,
    trace: "retain-on-failure",
    ...(chromiumExecutablePath && {
      launchOptions: { executablePath: chromiumExecutablePath },
    }),
  },
  webServer: {
    command: "pnpm e2e:server",
    url: `${baseURL}/login`,
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: "pipe",
    stderr: "pipe",
  },
  projects: [
    {
      name: "setup",
      testMatch: /.*\.setup\.ts/,
      use: { extraHTTPHeaders: { "x-e2e-secret": e2eSecret } },
    },
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        storageState: authFile,
      },
      dependencies: ["setup"],
    },
  ],
});
