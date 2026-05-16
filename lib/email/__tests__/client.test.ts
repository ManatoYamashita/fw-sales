/**
 * `emailClient.send()` の単体テスト (auth-and-notifications spec, Issue #16)
 *
 * カバレッジ:
 * 1. `RESEND_API_KEY` 未設定時 → `kind: 'noop', reason: 'missing_api_key'`
 * 2. `to` が `@local.invalid` で終わる(placeholder)→ `kind: 'noop', reason: 'placeholder_recipient'`
 * 3. 件名に自動で `[fw-sales] ` プレフィックス付与
 * 4. Resend 送信失敗 → `kind: 'failed'` を返し throw しない
 *
 * 関連: requirements.md §4.1〜4.4, §8.3
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

// Resend SDK を全テストでモック化(実通信を防ぐ)。`Resend` は `new` 起動される
// クラスのため class で実装する。`sendMock` を class フィールド経由で公開して
// テストから呼び出し検証する。
const sendMock = vi.fn();
vi.mock("resend", () => {
  return {
    Resend: class FakeResend {
      emails = { send: sendMock };
    },
  };
});

describe("emailClient.send", () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    // 各テスト開始時に env をクリーンな状態に戻す
    process.env = { ...ORIGINAL_ENV };
    delete process.env.RESEND_API_KEY;
    delete process.env.RESEND_FROM_EMAIL;
    sendMock.mockReset();
    // client.ts の module-level singleton (_resendInstance / _missingKeyWarned)
    // を毎テスト初期化するため module キャッシュをクリア
    vi.resetModules();
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  it("RESEND_API_KEY 未設定時は kind:'noop' / reason:'missing_api_key' を返す", async () => {
    const { emailClient } = await import("../client");
    // RESEND_API_KEY / FROM_EMAIL とも未設定
    const result = await emailClient.send({
      to: "user@example.com",
      subject: "テスト",
      html: "<p>本文</p>",
    });
    expect(result.kind).toBe("noop");
    if (result.kind === "noop") {
      expect(result.reason).toBe("missing_api_key");
    }
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("to が @local.invalid で終わる場合は kind:'noop' / reason:'placeholder_recipient' を返す", async () => {
    process.env.RESEND_API_KEY = "test-key";
    process.env.RESEND_FROM_EMAIL = "from@example.com";
    const { emailClient } = await import("../client");

    const result = await emailClient.send({
      to: "placeholder-yamada@local.invalid",
      subject: "テスト",
      html: "<p>本文</p>",
    });
    expect(result.kind).toBe("noop");
    if (result.kind === "noop") {
      expect(result.reason).toBe("placeholder_recipient");
    }
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("件名に [fw-sales] プレフィックスが自動付与される", async () => {
    process.env.RESEND_API_KEY = "test-key";
    process.env.RESEND_FROM_EMAIL = "from@example.com";
    sendMock.mockResolvedValueOnce({
      data: { id: "msg_123" },
      error: null,
    });

    const { emailClient } = await import("../client");
    const result = await emailClient.send({
      to: "user@example.com",
      subject: "テスト件名",
      html: "<p>本文</p>",
    });

    expect(result.kind).toBe("ok");
    expect(sendMock).toHaveBeenCalledTimes(1);
    const sendArg = sendMock.mock.calls[0]?.[0] as { subject: string };
    expect(sendArg.subject).toBe("[fw-sales] テスト件名");
  });

  it("Resend 送信失敗時は kind:'failed' を返し throw しない", async () => {
    process.env.RESEND_API_KEY = "test-key";
    process.env.RESEND_FROM_EMAIL = "from@example.com";
    sendMock.mockResolvedValueOnce({
      data: null,
      error: { message: "Rate limit exceeded" },
    });

    const { emailClient } = await import("../client");
    // throw しないこと自体が検証対象
    const result = await emailClient.send({
      to: "user@example.com",
      subject: "テスト",
      html: "<p>本文</p>",
    });

    expect(result.kind).toBe("failed");
    if (result.kind === "failed") {
      expect(result.error).toContain("Rate limit");
    }
  });

  it("buildSubject は既に [fw-sales] が付いている場合に二重付与しない", async () => {
    const { emailClient } = await import("../client");
    expect(emailClient.buildSubject("テスト")).toBe("[fw-sales] テスト");
    expect(emailClient.buildSubject("[fw-sales] テスト")).toBe("[fw-sales] テスト");
  });
});
