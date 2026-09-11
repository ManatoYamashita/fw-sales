/**
 * Places エラーの分類・sanitize のユニットテスト (Issue #201)。
 *
 * 受け入れ条件のうち「生 response body が戻り値に含まれない」「status 別または
 * 種類別の安全なユーザー向けメッセージになる」「API key を UI へ出さない」を
 * このファイルで機械的に固定する。
 */

import { describe, expect, it } from "vitest";
import {
  PLACES_USER_MESSAGES,
  PLACES_USER_MESSAGE_OVERRIDES,
  PlacesApiError,
  PlacesApiKeyMissingError,
  PlacesIncompleteDataError,
  classifyPlacesError,
  getPlacesErrorStatus,
  resolvePlacesUserMessage,
  toPlacesDiagnosticKind,
  toUserFacingPlacesMessage,
} from "../errors";
import type { PlacesErrorKind, PlacesMessageContext } from "../errors";

/** `toUserFacingPlacesMessage` / `resolvePlacesUserMessage` が受け付ける全導線。 */
const CONTEXTS: readonly PlacesMessageContext[] = ["search", "details", "add"];

/** 既定文言テーブルの全 kind。kind を足したらここへ自動で載る。 */
const KINDS = Object.keys(PLACES_USER_MESSAGES) as PlacesErrorKind[];

/** 詳細取得・追加の導線。「その店舗だけ」の失敗なので検索条件の変更では解決しない。 */
const PLACE_SCOPED_CONTEXTS: readonly PlacesMessageContext[] = ["details", "add"];

const SECRET_BODY =
  '{"error":{"code":403,"message":"The caller does not have permission","details":["internal-project-42"]}}';

function timeoutError(name: "TimeoutError" | "AbortError"): Error {
  const err = new Error("The operation was aborted due to timeout");
  err.name = name;
  return err;
}

describe("PlacesApiError", () => {
  it("message に status のみを載せ、レスポンス本文を保持しない", () => {
    const err = new PlacesApiError(500);
    expect(err.message).toBe("Places API エラー (500)");
    expect(err.status).toBe(500);
    expect(err.name).toBe("PlacesApiError");
    expect(err.message).not.toContain(SECRET_BODY);
  });

  it("Error のサブクラスとして扱える", () => {
    expect(new PlacesApiError(404)).toBeInstanceOf(Error);
  });
});

describe("PlacesApiKeyMissingError", () => {
  it("既存文言を維持する (places-fallback の文字列判定との後方互換)", () => {
    const err = new PlacesApiKeyMissingError();
    expect(err.message).toBe("GOOGLE_PLACES_API_KEY が設定されていません");
    expect(err.name).toBe("PlacesApiKeyMissingError");
  });
});

describe("PlacesIncompleteDataError", () => {
  it("既存文言を維持し、name で判別できる", () => {
    const err = new PlacesIncompleteDataError();
    expect(err.message).toBe("店舗情報が不足しているため詳細を取得できませんでした");
    expect(err.name).toBe("PlacesIncompleteDataError");
    expect(err).toBeInstanceOf(Error);
  });

  it("HTTP status を持たない (Places が 2xx を返した上での欠落であるため)", () => {
    expect(getPlacesErrorStatus(new PlacesIncompleteDataError())).toBeUndefined();
  });

  it("kind / 診断種別ともに incomplete_data へ分類される", () => {
    expect(classifyPlacesError(new PlacesIncompleteDataError())).toBe("incomplete_data");
    expect(toPlacesDiagnosticKind(new PlacesIncompleteDataError())).toBe("incomplete_data");
  });

  it("再試行を促さない専用文言になり、fallback へ落ちない", () => {
    const fallback = "詳細情報の取得に失敗しました。時間をおいて再度お試しください。";
    const message = toUserFacingPlacesMessage(new PlacesIncompleteDataError(), fallback, "details");

    expect(message).toBe(PLACES_USER_MESSAGES.incomplete_data);
    expect(message).not.toBe(fallback);
    // 決定的な失敗なので再試行を促す文言を含めない (無駄な Places 呼び出しを誘発するため)
    expect(message).not.toContain("時間をおいて");
  });
});

describe("getPlacesErrorStatus", () => {
  it("型付きエラーから status を読む", () => {
    expect(getPlacesErrorStatus(new PlacesApiError(429))).toBe(429);
  });

  it("name + status の形状 (duck typing) で判定する", () => {
    // Vitest の module mock / bundler の chunk 跨ぎで instanceof が落ちる状況の再現。
    const cloned = { name: "PlacesApiError", status: 503, message: "Places API エラー (503)" };
    expect(getPlacesErrorStatus(cloned)).toBe(503);
  });

  it("旧 message 形式からも後方互換で抽出する", () => {
    expect(getPlacesErrorStatus(new Error(`Places API エラー (403): ${SECRET_BODY}`))).toBe(403);
  });

  it("Places 由来でなければ undefined", () => {
    expect(getPlacesErrorStatus(new Error("relation does not exist"))).toBeUndefined();
    expect(getPlacesErrorStatus(null)).toBeUndefined();
  });

  it("message の途中に status 形式を含むだけの他モジュール由来エラーは拾わない (#221 review)", () => {
    // Drizzle の `DrizzleQueryError.message` は `Failed query: <sql>\nparams: <params>` 形式で、
    // params にはユーザーが入力した検索キーワードがそのまま載る。部分一致で拾うと
    // 「キーワードに `エラー (503)` と打つ」だけで DB 障害が Places 由来へ誤分類される。
    const drizzleError = new Error(
      'Failed query: insert into "place_candidates" ...\nparams: 居酒屋 エラー (503),渋谷駅',
    );
    expect(getPlacesErrorStatus(drizzleError)).toBeUndefined();
    expect(classifyPlacesError(drizzleError)).toBe("unknown");
  });
});

describe("classifyPlacesError", () => {
  it.each([
    [400, "invalid_request"],
    [401, "permission_denied"],
    [403, "permission_denied"],
    [404, "not_found"],
    [422, "invalid_request"],
    [429, "rate_limited"],
    [500, "server_error"],
    [503, "server_error"],
  ] as const)("HTTP %i → %s", (status, kind) => {
    expect(classifyPlacesError(new PlacesApiError(status))).toBe(kind);
  });

  it.each(["TimeoutError", "AbortError"] as const)("%s は timeout", (name) => {
    expect(classifyPlacesError(timeoutError(name))).toBe("timeout");
  });

  it("API キー未設定は missing_api_key", () => {
    expect(classifyPlacesError(new PlacesApiKeyMissingError())).toBe("missing_api_key");
    // 型付きエラー化以前の生 Error 経路も拾う
    expect(classifyPlacesError(new Error("GOOGLE_PLACES_API_KEY が設定されていません"))).toBe(
      "missing_api_key",
    );
  });

  it("Places 由来でない例外は unknown", () => {
    expect(classifyPlacesError(new Error("boom"))).toBe("unknown");
    expect(classifyPlacesError("just a string")).toBe("unknown");
    expect(classifyPlacesError(undefined)).toBe("unknown");
  });

  it("message の途中に API キー名を含むだけの他モジュール由来エラーは拾わない (#221 review)", () => {
    // status 形式と同じ理由。外部入力を含みうる message へ部分一致を掛けない。
    expect(
      classifyPlacesError(
        new Error('Failed query: insert into "logs" ...\nparams: GOOGLE_PLACES_API_KEY'),
      ),
    ).toBe("unknown");
  });

  it("timeout 判定は message 文言ではなく name に依存する", () => {
    expect(classifyPlacesError(new Error("The operation was aborted due to timeout"))).toBe(
      "unknown",
    );
  });
});

describe("toPlacesDiagnosticKind", () => {
  it("旧 stage0 のフォーマットを維持する", () => {
    expect(toPlacesDiagnosticKind(new PlacesApiError(403))).toBe("api_error:403");
    expect(toPlacesDiagnosticKind(new Error(`Places API エラー (403): ${SECRET_BODY}`))).toBe(
      "api_error:403",
    );
    expect(toPlacesDiagnosticKind(timeoutError("TimeoutError"))).toBe("timeout");
    expect(toPlacesDiagnosticKind(new PlacesApiKeyMissingError())).toBe("missing_api_key");
    expect(toPlacesDiagnosticKind(new Error("boom"))).toBe("unknown");
  });

  it("レスポンス本文を含まない", () => {
    const kind = toPlacesDiagnosticKind(new Error(`Places API エラー (403): ${SECRET_BODY}`));
    expect(kind).not.toContain("permission");
    expect(kind).not.toContain("internal-project-42");
  });
});

describe("toUserFacingPlacesMessage", () => {
  const FALLBACK = "検索に失敗しました。時間をおいて再度お試しください。";

  it("分類できた場合は kind 別の文言を返す", () => {
    expect(toUserFacingPlacesMessage(new PlacesApiError(429), FALLBACK, "search")).toBe(
      PLACES_USER_MESSAGES.rate_limited,
    );
    expect(toUserFacingPlacesMessage(new PlacesApiError(500), FALLBACK, "search")).toBe(
      PLACES_USER_MESSAGES.server_error,
    );
  });

  it.each(CONTEXTS)("%s: 分類できない場合は fallback を返し、元の message を含めない", (context) => {
    const err = new Error('relation "stores" does not exist');
    expect(toUserFacingPlacesMessage(err, FALLBACK, context)).toBe(FALLBACK);
    expect(toUserFacingPlacesMessage(err, FALLBACK, context)).not.toContain("stores");
  });

  it.each(CONTEXTS)("%s: 生レスポンス本文・API キーを一切返さない", (context) => {
    const key = "AIzaSyA1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q";
    const err = new Error(`Places API エラー (403): ${SECRET_BODY} key=${key}`);
    const message = toUserFacingPlacesMessage(err, FALLBACK, context);
    expect(message).toBe(PLACES_USER_MESSAGES.permission_denied);
    expect(message).not.toContain("internal-project-42");
    expect(message).not.toContain("AIzaSy");
    expect(message).not.toContain(SECRET_BODY);
  });

  it("導線ごとに文言を出し分ける (#222)", () => {
    const invalid = new PlacesApiError(400);
    const search = toUserFacingPlacesMessage(invalid, FALLBACK, "search");
    const details = toUserFacingPlacesMessage(invalid, FALLBACK, "details");
    const add = toUserFacingPlacesMessage(invalid, FALLBACK, "add");

    expect(new Set([search, details, add]).size).toBe(3);
    expect(search).toBe(PLACES_USER_MESSAGE_OVERRIDES.search.invalid_request);
    expect(details).toBe(PLACES_USER_MESSAGE_OVERRIDES.details.invalid_request);
    expect(add).toBe(PLACES_USER_MESSAGE_OVERRIDES.add.invalid_request);
  });

  it("context は必須引数で、渡し忘れは typecheck で落ちる (#222)", () => {
    // 4 アクションの配線漏れを型で検出する設計。optional / デフォルト値へ緩めると
    // この `@ts-expect-error` が「未使用の抑制」になり `pnpm typecheck` が失敗する。
    // 実行はしない (context 無しの呼び出しは実行時にも成立しないため)。
    const callWithoutContext = () =>
      // @ts-expect-error context を省略した呼び出しは型エラーであること
      toUserFacingPlacesMessage(new PlacesApiError(500), FALLBACK);

    expect(callWithoutContext).toBeTypeOf("function");
  });
});

describe("PLACES_USER_MESSAGES", () => {
  it("unknown 以外はすべて文言を持ち、unknown だけが fallback 委譲の null", () => {
    const entries = Object.entries(PLACES_USER_MESSAGES);
    expect(entries.length).toBeGreaterThan(0);
    for (const [kind, message] of entries) {
      if (kind === "unknown") {
        expect(message).toBeNull();
      } else {
        expect(message).toBeTruthy();
      }
    }
  });

  it("既定文言が特定アクションの文脈に依存しない (#221 review)", () => {
    // この表は全導線で共用する既定値。override が無い kind / context ではこれが
    // そのまま出るため、「店舗検索」を主語に固定したり「条件を変えて」のように
    // その導線で無意味な操作を促したりしてはならない。導線固有の言い回しは
    // `PLACES_USER_MESSAGE_OVERRIDES` 側の責務 (#222)。
    //
    // 語幹ではなく語そのものを禁じる。「条件を変えて」だけを禁止していた版は
    // 「検索条件を変えるか」を素通りさせており、テスト名が掲げる不変条件を
    // 実際には守れていなかった (#221 review)。「候補」は全導線が同じエリア検索
    // 結果の一覧を指すため許容する。
    const contextBound = ["検索", "条件"];
    for (const [kind, message] of Object.entries(PLACES_USER_MESSAGES)) {
      if (message === null) continue;
      for (const phrase of contextBound) {
        expect(
          message,
          `${kind}: "${phrase}" は検索導線を前提にした表現です。既定文言はどの導線でも成立する表現にしてください。`,
        ).not.toContain(phrase);
      }
    }
  });
});

describe("PLACES_USER_MESSAGE_OVERRIDES (#222)", () => {
  it("全 context のエントリを持つ (override 無しは空オブジェクトで明示する)", () => {
    expect(Object.keys(PLACES_USER_MESSAGE_OVERRIDES).sort()).toEqual([...CONTEXTS].sort());
  });

  it("既定値と同一の文言を重複させない", () => {
    for (const context of CONTEXTS) {
      for (const [kind, message] of Object.entries(PLACES_USER_MESSAGE_OVERRIDES[context])) {
        expect(message).toBeTruthy();
        expect(
          message,
          `${context}.${kind}: 既定値と同じ文言の override は不要です`,
        ).not.toBe(PLACES_USER_MESSAGES[kind as PlacesErrorKind]);
      }
    }
  });

  it("unknown を override しない (fallback 委譲を壊さない)", () => {
    // 型でも `Exclude<PlacesErrorKind, "unknown">` により禁じているが、
    // Issue #201 の中核設計なので実行時にも固定する。
    for (const context of CONTEXTS) {
      expect(PLACES_USER_MESSAGE_OVERRIDES[context]).not.toHaveProperty("unknown");
    }
  });
});

describe("resolvePlacesUserMessage (#222)", () => {
  it.each(CONTEXTS)("%s: unknown だけが null で、他の kind は必ず文言を返す", (context) => {
    for (const kind of KINDS) {
      const message = resolvePlacesUserMessage(kind, context);
      if (kind === "unknown") {
        expect(message).toBeNull();
      } else {
        expect(message, `${context}.${kind}`).toBeTruthy();
      }
    }
  });

  it("解決後の全文言に技術用語 (HTTP status / API / Google) を出さない", () => {
    // 既定値だけでなく override も含めた**実際に UI へ出る値**を検査する。
    const forbidden = ["HTTP", "API", "Google", "status", "GOOGLE_PLACES", "4", "5"];
    for (const context of CONTEXTS) {
      for (const kind of KINDS) {
        const message = resolvePlacesUserMessage(kind, context);
        if (message === null) continue;
        for (const word of forbidden) {
          expect(message, `${context}.${kind} に "${word}" が含まれています`).not.toContain(word);
        }
      }
    }
  });

  it.each(PLACE_SCOPED_CONTEXTS)("%s: 検索条件の変更を促さない (#222 受け入れ条件)", (context) => {
    // 詳細取得・追加が失敗するのは「その店舗だけ」。検索条件を変えても解決しないので、
    // 案内してはならない。一覧を取り直す「検索し直す」は有効な行動なので禁じない。
    for (const kind of KINDS) {
      const message = resolvePlacesUserMessage(kind, context);
      if (message === null) continue;
      for (const phrase of ["検索条件", "条件を変え"]) {
        expect(
          message,
          `${context}.${kind}: "${phrase}" はその店舗の失敗に対して無意味な行動です`,
        ).not.toContain(phrase);
      }
    }
  });

  it("search: 検索条件が原因になりうる kind では条件変更を案内する (#222 受け入れ条件)", () => {
    // 既定文言 (どの導線でも取れる行動しか書けない) より的確であることの確認。
    for (const kind of ["invalid_request", "not_found"] as const) {
      const message = resolvePlacesUserMessage(kind, "search");
      expect(message, `search.${kind}`).toContain("条件");
      expect(message).not.toBe(PLACES_USER_MESSAGES[kind]);
    }
  });

  it("search: not_found が検索結果 0 件と紛らわしい既定文言のままにならない (#222)", () => {
    // 検索そのものが失敗した状態なので、「候補一覧が既にある」前提の案内は出さない。
    const message = resolvePlacesUserMessage("not_found", "search");
    expect(message).not.toContain("別の候補");
  });

  it("導線を跨いで同じ案内で足りる kind は既定文言のままにする (表を 27 項目へ膨らませない)", () => {
    const sharedKinds = [
      "missing_api_key",
      "timeout",
      "rate_limited",
      "permission_denied",
      "server_error",
      "incomplete_data",
    ] as const;
    for (const kind of sharedKinds) {
      for (const context of CONTEXTS) {
        expect(resolvePlacesUserMessage(kind, context), `${context}.${kind}`).toBe(
          PLACES_USER_MESSAGES[kind],
        );
      }
    }
  });
});
