import "server-only";

import { FIRSTWEB_TENANT_ID } from "@/lib/db/schema";

/**
 * いま処理しているテナントの ID を返す (マルチテナント化 #365 / #367)。
 *
 * テナントは本来リクエスト (アクセス元のホスト名) から決めるが、その切り替えは #373 で行う。
 * それまでは Firstweb に固定し、`headers()` / `cookies()` を読まない。リクエストの値を
 * 読むと、ここを呼ぶページが静的シェルを失うため (#115 の static PPR を保つ)。
 *
 * `'use cache'` の関数の中では呼ばず、外で解決した値を引数で渡すこと
 * (引数はキャッシュキーに含まれる)。#373 以降はリクエストに依存するため。
 */
export async function resolveTenantId(): Promise<string> {
  return FIRSTWEB_TENANT_ID;
}
