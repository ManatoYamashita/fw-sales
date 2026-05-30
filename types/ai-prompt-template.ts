/**
 * AI プロンプトテンプレート型定義 (Issue #42)
 *
 * - `FewShotExample`: ユーザーが編集可能な Few-shot 例の 1 件分
 * - `AiPromptTemplate`: DB レコードと 1:1 対応するアプリ型
 * - `AiPromptTemplateInput`: insert / update 時の入力型
 * - `TemplateBody`: body(text) の判別共用体 (`fewshots` | `freeform`)
 * - `parseTemplateBody` / `serializeFewshots` / `serializeFreeform`: body(text) との相互変換
 *
 * 詳細バリデーション(最大 5 件・4000 字制約等)は Server Actions 側で行う。
 * 本ファイルは型と基本的な parse / serialize に留める。
 */

export interface FewShotExample {
  title: string;
  store_meta: string;
  /** `{ASSIGNED_SALES}` placeholder を含む架電スクリプト例 */
  call_script_ideal: string;
}

/** テンプレート本文の種別。 */
export type PromptTemplateKind = "fewshots" | "freeform";

/** 自由記述テンプレート本文の最大文字数(サーバー検証と UI で共有)。 */
export const MAX_FREEFORM_LENGTH = 8000;

/**
 * body (JSON 文字列) をパースして得られる判別共用体。
 * - `fewshots`: Few-shot 例の配列(構造化された入出力例)
 * - `freeform`: ユーザーが自由記述したプレーンテキスト(初心者向け)
 */
export type TemplateBody =
  | { kind: "fewshots"; fewshots: FewShotExample[] }
  | { kind: "freeform"; text: string };

export interface AiPromptTemplate {
  id: string;
  user_id: string;
  name: string;
  is_default: boolean;
  /**
   * JSON 文字列。判別共用体 `TemplateBody` を直列化したもの:
   * - `{ "kind": "fewshots", "fewshots": FewShotExample[] }`
   * - `{ "kind": "freeform", "text": string }`
   * 旧形式 `{ "fewshots": [...] }` (kind 無し) も後方互換で fewshots として解釈する。
   */
  body: string;
  created_at: string;
  updated_at: string;
}

export interface AiPromptTemplateInput {
  name: string;
  is_default: boolean;
  body: string;
}

function isFewShotExample(v: unknown): v is FewShotExample {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const obj = v as Record<string, unknown>;
  return (
    typeof obj.title === "string" &&
    typeof obj.store_meta === "string" &&
    typeof obj.call_script_ideal === "string"
  );
}

/**
 * body (JSON 文字列) を判別共用体 `TemplateBody` にパースする。
 * パース失敗・スキーマ不一致の場合は null を返す。
 *
 * 後方互換: `kind` が無く `fewshots` 配列を持つ旧形式は fewshots として解釈する。
 */
export function parseTemplateBody(body: string): TemplateBody | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }
  const obj = parsed as Record<string, unknown>;

  // freeform: kind === "freeform" かつ text が文字列
  if (obj.kind === "freeform") {
    return typeof obj.text === "string"
      ? { kind: "freeform", text: obj.text }
      : null;
  }

  // fewshots: 明示 kind、または旧形式(kind 無し + fewshots 配列)
  if (obj.kind === "fewshots" || obj.kind === undefined) {
    if (!Array.isArray(obj.fewshots)) return null;
    if (!obj.fewshots.every(isFewShotExample)) return null;
    return { kind: "fewshots", fewshots: obj.fewshots as FewShotExample[] };
  }

  return null;
}

/**
 * body (JSON 文字列) を FewShotExample[] にパースする。
 * freeform テンプレート・パース失敗時は null を返す。
 * `parseTemplateBody` に委譲する後方互換ヘルパー。
 */
export function parseFewshots(body: string): FewShotExample[] | null {
  const parsed = parseTemplateBody(body);
  return parsed && parsed.kind === "fewshots" ? parsed.fewshots : null;
}

/**
 * FewShotExample[] を body (JSON 文字列) にシリアライズする。
 */
export function serializeFewshots(fewshots: FewShotExample[]): string {
  return JSON.stringify({ kind: "fewshots", fewshots });
}

/**
 * 自由記述テキストを body (JSON 文字列) にシリアライズする。
 */
export function serializeFreeform(text: string): string {
  return JSON.stringify({ kind: "freeform", text });
}
