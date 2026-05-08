"use server";

/**
 * AI 分析 Server Action。
 *
 * `/stores/new` の [AI で分析] ボタン押下時に呼ばれる Server Action。
 * 順序: ① name non-empty → ② レート制限 → ③ プロンプト構築 → ④ LLM 呼出
 *      → ⑤ Zod 再検証 → ⑥ ActionResult として返却。
 *
 * - すべての失敗パスを `ActionResult.failure(message)` に正規化(SDK の生エラー漏洩防止)
 * - LLM 呼出は `AbortSignal.timeout(60_000)` で確実に中断(Req 2.6)
 *
 * 関連: design.md §「analyzeStoreAction」, requirements.md §2.3, §2.4, §2.6, §3.4, §3.5,
 *       §6.1, §6.3, §7.1, §7.2, §7.3
 */

import "server-only";

import {
  failure,
  readString,
  success,
  type ActionResult,
} from "./_helpers";
import { createGeminiClient, type AiClientError } from "@/lib/ai/client";
import { buildAnalysisPrompt } from "@/lib/ai/prompt";
import {
  getAiAnalysisJsonSchema,
  type AiAnalysisResult,
} from "@/lib/ai/schema";
import { validateAiAnalysis } from "@/lib/ai/validate";
import { checkRateLimit } from "@/lib/ai/rate-limiter";
import { OPERATOR_TYPES, type OperatorType } from "@/types/store";

const TIMEOUT_MS = 60_000;
const MAX_INSTRUCTIONS_LENGTH = 500;

function asOperatorType(raw: string): OperatorType {
  return (OPERATOR_TYPES as readonly string[]).includes(raw)
    ? (raw as OperatorType)
    : "未設定";
}

/** trim 後に空文字なら null、そうでなければ trim 済の値を返す。 */
function readNullableTrimmedString(
  formData: FormData,
  key: string,
): string | null {
  const raw = formData.get(key);
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed === "" ? null : trimmed;
}

/** review_avg / review_count を数値に変換し、不正値は 0 にフォールバック。 */
function readNumberOrZero(formData: FormData, key: string): number {
  const raw = formData.get(key);
  if (typeof raw !== "string" || raw.trim() === "") return 0;
  const num = Number(raw);
  return Number.isFinite(num) ? num : 0;
}

/** AiClientError discriminated union を UI 表示用文字列に正規化する。 */
function clientErrorToMessage(err: AiClientError): string {
  switch (err.kind) {
    case "missing_api_key":
      return "AI 分析の API キーが未設定です。環境変数 GEMINI_API_KEY を設定してください。";
    case "timeout":
      return "AI 分析がタイムアウトしました(60 秒)。再度お試しください。";
    case "rate_limit":
      return "AI 分析のレートリミットに達しました。しばらくお待ちください。";
    case "auth_error":
      return "AI 分析の認証に失敗しました。GEMINI_API_KEY を確認してください。";
    case "api_error":
      return `AI 分析 API がエラー (${err.status}) を返しました。再度お試しください。`;
    case "network_error":
      return "ネットワークエラーが発生しました。接続を確認して再度お試しください。";
    case "unknown":
      return err.message;
    default: {
      const _exhaustive: never = err;
      void _exhaustive;
      return "AI 分析で不明なエラーが発生しました。";
    }
  }
}

function isAiClientError(err: unknown): err is AiClientError {
  if (typeof err !== "object" || err === null) return false;
  if (!("kind" in err)) return false;
  const kind = (err as { kind: unknown }).kind;
  return (
    kind === "missing_api_key" ||
    kind === "timeout" ||
    kind === "rate_limit" ||
    kind === "auth_error" ||
    kind === "api_error" ||
    kind === "network_error" ||
    kind === "unknown"
  );
}

/**
 * `/stores/new` の [AI で分析] ボタン押下時に呼ばれる Server Action。
 *
 * 入力 FormData フィールド(設計書 §「Data Contracts / analyzeStoreAction Request」):
 * - name (必須), prefecture, city, address, genre, phone, site_url,
 *   instagram_url, map_url, review_avg, review_count, memo,
 *   operator_type, operator_name, htmlContent, additionalInstructions,
 *   assignedSales, storeId (nullable, 編集モード時に設定)
 *
 * 失敗時: ActionResult.failure(message) を返す。フォーム値・DB 状態は変更しない。
 */
export async function analyzeStoreAction(
  formData: FormData,
): Promise<ActionResult<AiAnalysisResult>> {
  // ① name non-empty チェック (Req 2.3)
  const name = readString(formData, "name");
  if (!name) {
    return failure("店舗名を入力してください");
  }

  // ② レート制限チェック (Req 6.3): API コスト発生前に防御
  const storeId = readNullableTrimmedString(formData, "storeId");
  const rateCheck = checkRateLimit(storeId);
  if (!rateCheck.ok) {
    return failure(rateCheck.message);
  }

  // ③ プロンプト構築 (Req 2.4, 3.4, 7.1, 7.2)
  const formValues = {
    name,
    prefecture: readString(formData, "prefecture"),
    city: readString(formData, "city"),
    address: readString(formData, "address"),
    genre: readString(formData, "genre"),
    phone: readString(formData, "phone"),
    site_url: readString(formData, "site_url"),
    instagram_url: readString(formData, "instagram_url"),
    map_url: readString(formData, "map_url"),
    review_avg: readNumberOrZero(formData, "review_avg"),
    review_count: readNumberOrZero(formData, "review_count"),
    memo: readString(formData, "memo"),
    operator_type: asOperatorType(readString(formData, "operator_type")),
    operator_name: readString(formData, "operator_name"),
  };
  const htmlContent = readNullableTrimmedString(formData, "htmlContent");
  const additionalInstructions = readString(formData, "additionalInstructions").slice(
    0,
    MAX_INSTRUCTIONS_LENGTH,
  );
  const assignedSales = readString(formData, "assignedSales");

  const { systemPrompt, userParts } = buildAnalysisPrompt({
    formValues,
    htmlContent,
    additionalInstructions,
    assignedSales,
  });

  // ④ LLM 呼出 (Req 2.6: 60s timeout 経由で AbortSignal が発火)
  const client = createGeminiClient();
  const signal = AbortSignal.timeout(TIMEOUT_MS);

  try {
    const raw = await client.generateAnalysis(
      {
        systemPrompt,
        userParts,
        jsonSchema: getAiAnalysisJsonSchema(),
      },
      signal,
    );

    // ⑤ Zod 再検証 (Req 3.5, 7.3)
    const validated = validateAiAnalysis(raw);
    if (!validated.ok) {
      return failure(
        `AI の応答が想定外の形式でした。再度お試しください。 (${validated.error.zodIssues
          .slice(0, 3)
          .join("; ")})`,
      );
    }

    return success(validated.value);
  } catch (err) {
    // AiClientError 型は client.ts で正規化済(API キー漏洩防止)
    if (isAiClientError(err)) {
      return failure(clientErrorToMessage(err));
    }
    // 想定外の生エラーは中身を露出しない
    return failure("AI 分析でエラーが発生しました。再度お試しください。");
  }
}
