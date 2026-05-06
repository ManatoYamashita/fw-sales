/**
 * Gemini API レスポンスを Zod で再検証する。
 *
 * Gemini の `responseJsonSchema` 強制は構文レベルの妥当性のみ保証し、
 * `string.maxLength` や `number.min/max` 等のセマンティック制約は稀に通すことが
 * 確認されている(research.md Topic 2、Decision 3)。本ファイルが二段目の防御として
 * 必ず Zod で再検証し、失敗時はクライアント表示可能な簡素なメッセージを返す。
 *
 * 関連: design.md §「Validator」, requirements.md §3.5, §7.3
 */

import "server-only";

import type { ZodIssue } from "zod";
import { AiAnalysisSchema } from "./schema";
import type { AiAnalysisResult } from "./schema";

export type AiValidationError = {
  kind: "schema_violation";
  zodIssues: string[];
};

export type Result<T, E> =
  | { ok: true; value: T }
  | { ok: false; error: E };

/**
 * 任意の入力値を `AiAnalysisResult` として検証する。
 *
 * - 成功時は型安全な `AiAnalysisResult` を返す
 * - 失敗時は `kind: "schema_violation"` と `zodIssues` (path: message 形式の文字列配列) を返す
 *
 * クライアントへ表示する際は `zodIssues` を要約してから toast に流す想定
 * (生 issues をそのまま見せると技術的すぎるため)。
 */
export function validateAiAnalysis(
  raw: unknown,
): Result<AiAnalysisResult, AiValidationError> {
  const result = AiAnalysisSchema.safeParse(raw);
  if (result.success) {
    return { ok: true, value: result.data };
  }
  const zodIssues = result.error.issues.map(formatIssue);
  return {
    ok: false,
    error: { kind: "schema_violation", zodIssues },
  };
}

function formatIssue(issue: ZodIssue): string {
  const path = issue.path.length > 0 ? issue.path.join(".") : "(root)";
  return `${path}: ${issue.message}`;
}
