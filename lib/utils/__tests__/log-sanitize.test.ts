/**
 * 診断ログ用サニタイザのユニットテスト (Issue #201)。
 *
 * `clipForLog` は元々 `lib/security/safe-http-fetch.ts` の private 実装だったものを
 * 共有ユーティリティへ移設したもので、挙動の回帰は
 * `lib/security/__tests__/safe-http-fetch.test.ts` 側でも引き続き担保されている。
 */

import { describe, expect, it } from "vitest";
import { LOG_FIELD_MAX_CHARS, clipForLog, redactSecrets } from "../log-sanitize";

describe("clipForLog", () => {
  it("上限以下の文字列はそのまま返す", () => {
    const s = "a".repeat(LOG_FIELD_MAX_CHARS);
    expect(clipForLog(s)).toBe(s);
  });

  it("上限を超えた場合は切り詰めて元の長さを併記する", () => {
    const clipped = clipForLog("a".repeat(5001));
    expect(clipped).toHaveLength(LOG_FIELD_MAX_CHARS + "…(5001)".length);
    expect(clipped.endsWith("…(5001)")).toBe(true);
  });

  it("空文字を落とさない", () => {
    expect(clipForLog("")).toBe("");
  });
});

describe("redactSecrets", () => {
  const KEY = "AIzaSyA1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q";

  it("Google API キー形状を [REDACTED] へ置換する", () => {
    expect(KEY).toHaveLength(39); // "AIza" + 35
    const out = redactSecrets(`{"error":{"message":"key=${KEY} is invalid"}}`);
    expect(out).not.toContain(KEY);
    expect(out).toContain("[REDACTED]");
    // 秘匿値以外の診断情報は残す
    expect(out).toContain("is invalid");
  });

  it("複数出現をすべて置換する", () => {
    const out = redactSecrets(`${KEY} and ${KEY}`);
    expect(out).toBe("[REDACTED] and [REDACTED]");
  });

  it("キーを含まない文字列は変更しない", () => {
    const s = 'Places API returned INVALID_ARGUMENT for textQuery "居酒屋 渋谷"';
    expect(redactSecrets(s)).toBe(s);
  });

  it("redact を先に適用すればキーの断片が末尾に残らない", () => {
    // clipForLog を先に掛けるとキーが途中で切れて置換対象から外れうる。
    // 正しい合成順 (redact → clip) を回帰として固定する。
    const body = `${"x".repeat(LOG_FIELD_MAX_CHARS - 10)}${KEY}`;
    expect(clipForLog(redactSecrets(body))).not.toContain("AIzaSy");
  });
});
