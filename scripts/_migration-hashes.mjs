import { createHash } from "node:crypto";

/**
 * DrizzleはSQLの生バイトをハッシュ化します。Windowsで適用したCRLFと
 * macOS/CIのLFは別ハッシュになるため、改行だけの差を厳密に照合します。
 * @param {string} sql
 */
export function getMigrationHashes(sql) {
  const lf = sql.replaceAll("\r\n", "\n");
  return [...new Set([sql, lf, lf.replaceAll("\n", "\r\n")]
    .map(value => createHash("sha256").update(value).digest("hex")))];
}
