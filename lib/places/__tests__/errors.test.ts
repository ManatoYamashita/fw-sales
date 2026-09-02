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
  PlacesApiError,
  PlacesApiKeyMissingError,
  PlacesIncompleteDataError,
  classifyPlacesError,
  getPlacesErrorStatus,
  toPlacesDiagnosticKind,
  toUserFacingPlacesMessage,
} from "../errors";

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
    const message = toUserFacingPlacesMessage(new PlacesIncompleteDataError(), fallback);

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
    expect(toUserFacingPlacesMessage(new PlacesApiError(429), FALLBACK)).toBe(
      PLACES_USER_MESSAGES.rate_limited,
    );
    expect(toUserFacingPlacesMessage(new PlacesApiError(500), FALLBACK)).toBe(
      PLACES_USER_MESSAGES.server_error,
    );
  });

  it("分類できない場合は fallback を返し、元の message を含めない", () => {
    const err = new Error('relation "stores" does not exist');
    expect(toUserFacingPlacesMessage(err, FALLBACK)).toBe(FALLBACK);
    expect(toUserFacingPlacesMessage(err, FALLBACK)).not.toContain("stores");
  });

  it("生レスポンス本文・API キーを一切返さない", () => {
    const key = "AIzaSyA1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q";
    const err = new Error(`Places API エラー (403): ${SECRET_BODY} key=${key}`);
    const message = toUserFacingPlacesMessage(err, FALLBACK);
    expect(message).toBe(PLACES_USER_MESSAGES.permission_denied);
    expect(message).not.toContain("internal-project-42");
    expect(message).not.toContain("AIzaSy");
    expect(message).not.toContain(SECRET_BODY);
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

  it("文言が特定アクションの文脈に依存しない (#221 review)", () => {
    // このテーブルは検索 / 詳細取得 / 追加の 4 アクションで共用する。
    // 「店舗検索」を主語に固定したり「条件を変えて」のようにその画面に存在しない
    // 操作を促したりすると、詳細取得・追加の導線で取りようのない行動へ誘導する。
    const contextBound = ["店舗検索", "条件を変えて"];
    for (const [kind, message] of Object.entries(PLACES_USER_MESSAGES)) {
      if (message === null) continue;
      for (const phrase of contextBound) {
        expect(
          message,
          `${kind}: "${phrase}" は検索導線を前提にした表現です。詳細取得・追加でも成立する文言にしてください。`,
        ).not.toContain(phrase);
      }
    }
  });

  it("ユーザー向け文言に技術用語 (HTTP status / API / Google) を出さない", () => {
    const forbidden = ["HTTP", "API", "Google", "status", "GOOGLE_PLACES", "4", "5"];
    for (const [kind, message] of Object.entries(PLACES_USER_MESSAGES)) {
      if (message === null) continue;
      for (const word of forbidden) {
        expect(message, `${kind} に "${word}" が含まれています`).not.toContain(word);
      }
    }
  });
});
