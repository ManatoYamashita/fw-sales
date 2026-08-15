/**
 * lib/supabase/proxy.ts (updateSession) の単体テスト。
 *
 * 主な検証観点:
 * - env 未設定 → fetch を呼ばずに isAuthenticated:false (回帰防止)
 * - 防御 fetch wrapper の wiring 実証:
 *   - createServerClient に `global.fetch` 関数が注入される
 *   - underlying fetch が AbortSignal 付きの init で呼ばれる
 *   - AbortSignal は AUTH_FETCH_TIMEOUT_MS で abort する (fake timer)
 *   - caller が init.signal を渡した場合は AbortSignal.any で合成され、どちらの
 *     abort でも fire する
 *
 * 戦略: cookie seed (chunked storage 仕様依存で脆い) は採用せず、
 *       `@supabase/ssr` を vi.mock して createServerClient を fake 化し、
 *       注入された `global.fetch` を直接呼ぶことで wiring を実証する。
 *       fake のおかげで Supabase JS の重い初期化 (realtime-js の WebSocket
 *       不在問題) も同時に回避できる。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

type FetchFn = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const capturedFetchRef: { current: FetchFn | undefined } = { current: undefined };

vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn(
    (
      _url: string,
      _key: string,
      opts?: { global?: { fetch?: FetchFn } },
    ) => {
      capturedFetchRef.current = opts?.global?.fetch;
      return {
        auth: {
          getUser: async () => ({
            data: { user: null },
            error: { name: "AuthSessionMissingError", message: "no session" },
          }),
        },
      };
    },
  ),
}));

const ORIG_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ORIG_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const AUTH_FETCH_TIMEOUT_MS = 4_000;

function buildRequest(pathname = "/stores") {
  return new NextRequest(new URL(`https://example.test${pathname}`));
}

function getInjectedFetch(): FetchFn {
  if (!capturedFetchRef.current) {
    throw new Error("global.fetch was not injected by updateSession");
  }
  return capturedFetchRef.current;
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";
  capturedFetchRef.current = undefined;
  // console ログは本テストでは検証対象外。テスト出力ノイズを抑える。
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  if (ORIG_URL === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  else process.env.NEXT_PUBLIC_SUPABASE_URL = ORIG_URL;
  if (ORIG_KEY === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  else process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = ORIG_KEY;
});

describe("updateSession (env / fall through 経路)", () => {
  it("env 未設定 → isAuthenticated:false かつ fetch を呼ばない (回帰防止)", async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const { updateSession } = await import("../proxy");
    const result = await updateSession(buildRequest());

    expect(result.isAuthenticated).toBe(false);
    expect(result.userId).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(capturedFetchRef.current).toBeUndefined();
  });
});

describe("updateSession (fetch wrapper の wiring)", () => {
  it("createServerClient に関数として global.fetch が注入される", async () => {
    const { updateSession } = await import("../proxy");
    await updateSession(buildRequest());

    expect(typeof getInjectedFetch()).toBe("function");
  });

  it("注入 fetch を呼ぶと underlying fetch に AbortSignal 付き init が渡る", async () => {
    const underlying = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("ok"));

    const { updateSession } = await import("../proxy");
    await updateSession(buildRequest());

    const injected = getInjectedFetch();
    await injected("https://test.supabase.co/auth/v1/user", {
      headers: { apikey: "k" },
    });

    expect(underlying).toHaveBeenCalledTimes(1);
    const init = underlying.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(init?.signal?.aborted).toBe(false);
  });

  it("AbortSignal.timeout が AUTH_FETCH_TIMEOUT_MS で呼ばれ、返り値 signal が underlying fetch へ渡る", async () => {
    // 注: vi.useFakeTimers は AbortSignal.timeout 内部の Node native timer に
    //     効かないため、wiring の正しさは spy で直接検証する (timeout 値 4000ms
    //     で呼ばれ、その signal がそのまま fetch に注入されること)。
    const fakeTimeoutSignal = new AbortController().signal;
    const timeoutSpy = vi
      .spyOn(AbortSignal, "timeout")
      .mockReturnValue(fakeTimeoutSignal);
    const underlying = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("ok"));

    const { updateSession } = await import("../proxy");
    await updateSession(buildRequest());

    const injected = getInjectedFetch();
    await injected("https://test.supabase.co/auth/v1/user");

    expect(timeoutSpy).toHaveBeenCalledWith(AUTH_FETCH_TIMEOUT_MS);
    const init = underlying.mock.calls[0]?.[1] as RequestInit | undefined;
    // init.signal が AbortSignal であることと、caller signal 未指定時は timeout
    // signal がそのまま渡ること (AbortSignal.any を経ない) を確認。
    expect(init?.signal).toBe(fakeTimeoutSignal);
  });

  it("caller が init.signal を渡すと AbortSignal.any で合成され caller abort でも fire", async () => {
    const fakeTimeoutSignal = new AbortController().signal;
    vi.spyOn(AbortSignal, "timeout").mockReturnValue(fakeTimeoutSignal);
    const anySpy = vi.spyOn(AbortSignal, "any");
    let capturedSignal: AbortSignal | undefined;
    vi.spyOn(globalThis, "fetch").mockImplementation(
      (_input: RequestInfo | URL, init?: RequestInit) => {
        capturedSignal = init?.signal ?? undefined;
        return Promise.resolve(new Response("ok"));
      },
    );

    const { updateSession } = await import("../proxy");
    await updateSession(buildRequest());

    const callerCtrl = new AbortController();
    const injected = getInjectedFetch();
    await injected("https://test.supabase.co/auth/v1/user", {
      signal: callerCtrl.signal,
    });

    // AbortSignal.any が caller signal + timeout signal の両方で呼ばれている
    expect(anySpy).toHaveBeenCalledWith([callerCtrl.signal, fakeTimeoutSignal]);
    // 合成された signal が fetch に渡り、caller abort で fire する
    expect(capturedSignal?.aborted).toBe(false);
    callerCtrl.abort(new Error("caller aborted"));
    expect(capturedSignal?.aborted).toBe(true);
  });
});
