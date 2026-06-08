"use server";

/**
 * 営業資産生成統合 Server Action (store-basic-info / task 3.5, PR2)
 *
 * 店舗詳細の「営業資産を生成」ボタンから呼ばれる単一入口 (R7.4)。
 * `store.basic_info` (充足項目) + 貼付調査テキスト (構造化しない) + 任意の追加指示を
 * 入力に `AiAnalysisResult` (強み・弱み・グルメ課金・GBP・架電・confidence) を生成し
 * `store.ai_analysis_result` に保存する。**Stage 2 構造化 (`structurer`) を一切呼ばない**
 * (R7.3, #121)。
 *
 * 既存 `analyzeStoreAction` (`ai-analysis-actions.ts`, formValues 経路) および
 * `generateCallScriptFromMarkdownAction` (`research-paste-actions.ts`, markdown 経路) を
 * 本アクションへ統合する (design D6, task 3.6 で旧経路を撤去)。出力契約 `AiAnalysisResult`
 * は据置 (#113)。
 *
 * 関連: design.md §Actions / generateSalesAssetsAction, requirements.md §1.1 §4.1 §4.3
 *       §7.1 §7.2 §7.3 §7.4 §7.5
 */

import { revalidateTag } from "next/cache";
import { repos } from "@/lib/repositories";
import { CACHE_TAGS } from "@/lib/cache";
import { createGeminiClient, type AiClientError } from "@/lib/ai/client";
import { buildSalesAssetsPrompt } from "@/lib/ai/basic-info-prompt";
import {
  getAiAnalysisJsonSchema,
  type AiAnalysisResult,
} from "@/lib/ai/schema";
import { validateAiAnalysis } from "@/lib/ai/validate";
import { checkRateLimit } from "@/lib/ai/rate-limiter";
import { getCurrentSession } from "@/lib/supabase/server";
import { failure, success, type ActionResult } from "./_helpers";

const TIMEOUT_MS = 60_000;
const MAX_PASTED_LENGTH = 50_000;
const MAX_INSTRUCTIONS_LENGTH = 500;

/**
 * `AiClientError` を UI 表示用文字列に正規化する
 * (`ai-analysis-actions.ts` と同型ロジック、API キー漏洩防止)。
 */
function clientErrorToMessage(err: AiClientError): string {
  switch (err.kind) {
    case "missing_api_key":
      return "AI 生成の API キーが未設定です。環境変数 GEMINI_API_KEY を設定してください。";
    case "timeout":
      return "AI 生成がタイムアウトしました (60 秒)。再度お試しください。";
    case "rate_limit":
      return "AI 生成のレートリミットに達しました。しばらくお待ちください。";
    case "auth_error":
      return "AI 生成の認証に失敗しました。GEMINI_API_KEY を確認してください。";
    case "api_error":
      return `AI 生成 API がエラー (${err.status}) を返しました。再度お試しください。`;
    case "network_error":
      return "ネットワークエラーが発生しました。接続を確認して再度お試しください。";
    case "unknown":
      return err.message;
    default: {
      const _exhaustive: never = err;
      void _exhaustive;
      return "AI 生成で不明なエラーが発生しました。";
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
 * 充足済み `basic_info` と貼付調査テキストから営業資産を生成し
 * `store.ai_analysis_result` に保存する。
 *
 * @param storeId            生成対象の店舗 ID
 * @param pastedResearchText 貼付調査テキスト (空可、構造化しない: R4.2)
 * @param additionalInstructions ユーザー追加指示 (空可、500 字でクリップ)
 *
 * 振る舞い:
 * - 店舗名のみ充足でも実行可能 (R7.2)
 * - `structurer` / `structureFromPastedMarkdownAction` を呼ばない (R7.3)
 * - 結果は `store.ai_analysis_result` に保存し、再表示・再生成可能 (R7.5)
 */
export async function generateSalesAssetsAction(
  storeId: string,
  pastedResearchText: string,
  additionalInstructions: string = "",
): Promise<ActionResult<AiAnalysisResult>> {
  // ① 認証
  const session = await getCurrentSession();
  if (!session) {
    return failure("ログインが必要です");
  }

  // ② storeId 検証 + レート制限 (API コスト発生前に防御)
  if (typeof storeId !== "string" || storeId.trim() === "") {
    return failure("店舗 ID が指定されていません");
  }
  const rateCheck = checkRateLimit(storeId);
  if (!rateCheck.ok) {
    return failure(rateCheck.message);
  }

  // ③ 店舗取得 + 店舗名検証 (R1.1 店舗名のみ必須)
  const store = await repos.store.get(storeId);
  if (!store) {
    return failure("店舗が見つかりません");
  }
  if (!store.name || store.name.trim() === "") {
    return failure("店舗名が設定されていません");
  }

  // ④ 営業担当の display_name を解決 (発信者名に使う)
  let assignedSales = "";
  if (store.assigned_sales_user_id) {
    try {
      const profile = await repos.profile.findById(store.assigned_sales_user_id);
      assignedSales = profile?.display_name ?? "";
    } catch {
      assignedSales = "";
    }
  }

  // ⑤ プロンプト構築 (Stage 2 構造化を一切経由しない: R7.3)
  const trimmedPasted = (pastedResearchText ?? "").slice(0, MAX_PASTED_LENGTH);
  const trimmedInstructions = (additionalInstructions ?? "").slice(
    0,
    MAX_INSTRUCTIONS_LENGTH,
  );
  const { systemPrompt, userParts } = buildSalesAssetsPrompt({
    basicInfo: store.basic_info,
    pastedResearchText: trimmedPasted,
    additionalInstructions: trimmedInstructions,
    assignedSales,
  });

  // ⑥ Gemini 呼出 (60s timeout)
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

    // ⑦ Zod 再検証
    const validated = validateAiAnalysis(raw);
    if (!validated.ok) {
      return failure(
        `AI の応答が想定外の形式でした。再度お試しください。 (${validated.error.zodIssues
          .slice(0, 3)
          .join("; ")})`,
      );
    }

    // ⑧ 保存 + キャッシュ無効化 (R7.5 再表示可能)
    await repos.store.update(storeId, {
      ai_analysis_result: validated.value,
    });
    revalidateTag(CACHE_TAGS.store(storeId), "max");
    revalidateTag(CACHE_TAGS.stores, "max");

    return success(validated.value, "営業資産を生成しました");
  } catch (err) {
    if (isAiClientError(err)) {
      return failure(clientErrorToMessage(err));
    }
    return failure("AI 生成でエラーが発生しました。再度お試しください。");
  }
}
