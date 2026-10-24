import { expect, request, type TestInfo } from "@playwright/test";

/** 1 ページの読み直しの持ち時間。初回の要求は dev サーバのコンパイルを伴う。 */
const PAGE_TIMEOUT_MS = 90_000;

/**
 * SQL で作り直した値を、dev サーバの `'use cache'` にも読み直させる (#390)。
 *
 * 店舗 (`getStoreCached`) や通知 (`getRecentNotifications`) は `'use cache'` で読むため、
 * SQL で値を戻してもタグは失効せず、前の試行で表示した値が出続ける。dev サーバは
 * `Cache-Control: no-cache` の要求 (ブラウザの hard refresh と同じ) に限り、既存の
 * キャッシュを読まずに作り直して書き戻す (next の `use-cache-wrapper.js` の
 * `shouldForceRevalidate`)。そこで `beforeAll` で状態を作り直した直後に、spec が開く
 * ページをこの形で 1 回ずつ読み込む。
 *
 * テスト本体の画面遷移は通常のキャッシュのままにする。保存後に表示が変わることで、
 * Server Action によるキャッシュの失効も確かめているため。
 */
export async function refreshServerCache(
  testInfo: TestInfo,
  paths: readonly string[],
): Promise<void> {
  // 並列実行中の初回コンパイルは、フックの既定 (30 秒) を超えることがある。
  testInfo.setTimeout(testInfo.timeout + PAGE_TIMEOUT_MS * paths.length);
  const { baseURL, storageState } = testInfo.project.use;
  const context = await request.newContext({
    baseURL,
    storageState,
    extraHTTPHeaders: { "Cache-Control": "no-cache" },
    timeout: PAGE_TIMEOUT_MS,
  });
  try {
    for (const path of paths) {
      // 認証が切れていると /login へ転送され、読み直さないまま成功に見える。
      // 転送を追わず、そのページ自体が 200 で返ることを確かめる。
      const response = await context.get(path, { maxRedirects: 0 });
      expect(response.status(), `${path} を読み直せませんでした`).toBe(200);
    }
  } finally {
    await context.dispose();
  }
}
