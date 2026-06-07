"use server";

/**
 * 手動貼付フロー用 Server Actions (Issue #102)。
 *
 * 自動 Stage 1 (Deep Research API) / cron を経由せず、Gemini UI の専用 Gem で
 * 完走済みの Markdown を人手で運ぶ前提。既存資産のロジックを同期版に移植する:
 * - `structureFromPastedMarkdownAction`: 貼付 Markdown を Stage 2 構造化し
 *   `research_jobs`(done) + `research_reports` に保存 (pipeline.ts の Stage 2 finalize を移植)
 * - `generateCallScriptFromMarkdownAction`: 貼付 Markdown から強み/弱み/架電を生成
 *   (ai-analysis-actions.ts の analyzeStoreAction を移植、永続化はしない)
 *
 * 構造化と架電生成は独立 (構造化に失敗しても架電生成は実行できる)。
 */

import "server-only";

import { revalidateTag } from "next/cache";
import { failure, success, type ActionResult } from "./_helpers";
import { repos } from "@/lib/repositories";
import { CACHE_TAGS } from "@/lib/cache";
import { getCurrentSession } from "@/lib/supabase/server";
import { createStructurer } from "@/lib/ai/deep-research/structurer";
import { createGeminiClient, type AiClientError } from "@/lib/ai/client";
import { buildAnalysisPrompt } from "@/lib/ai/prompt";
import {
  getAiAnalysisJsonSchema,
  type AiAnalysisResult,
} from "@/lib/ai/schema";
import { validateAiAnalysis } from "@/lib/ai/validate";
import { checkRateLimit } from "@/lib/ai/rate-limiter";
import type {
  DeepResearchJob,
  DeepResearchReportInsert,
  HearingQuestion,
} from "@/types/deep-research";
import type { StageId } from "@/types/stage";

const STRUCTURE_TIMEOUT_MS = 60_000;
const ANALYSIS_TIMEOUT_MS = 60_000;
const MAX_INSTRUCTIONS_LENGTH = 500;

export interface StructureFromPastedResult {
  jobId: string;
  reportId: string;
  /** 51 項目の構造化に成功したか (false = フォールバックで full_markdown のみ保存)。 */
  structured: boolean;
}

/**
 * 貼付 Markdown を Stage 2 構造化し、research_jobs(done) + research_reports に保存する。
 *
 * - 構造化に失敗した場合は concise モードで 1 回だけ再試行する。
 * - なお失敗した場合は 8 カテゴリを空配列で保存し、full_markdown(原文)だけを残す
 *   (51 項目は諦めるが、原文の閲覧と架電生成は成立する)。
 * - 毎回新規 job を作成するため、同一店舗への再貼付は「追加・最新優先」となる
 *   (getReportByStore が created_at 最新の 1 件を返す既存設計と一致)。
 */
export async function structureFromPastedMarkdownAction(
  storeId: string,
  markdown: string,
): Promise<ActionResult<StructureFromPastedResult>> {
  if (typeof storeId !== "string" || storeId.trim() === "") {
    return failure("店舗 ID が指定されていません");
  }
  const md = typeof markdown === "string" ? markdown.trim() : "";
  if (md === "") {
    return failure("DeepResearch の結果 Markdown を貼り付けてください");
  }

  const session = await getCurrentSession();
  if (!session) return failure("構造化にはログインが必要です");

  const store = await repos.store.get(storeId);
  if (!store) return failure("対象店舗が見つかりません");

  // job は catch でも参照するため try 外で宣言する (例外時に failed 化してリークを防ぐ)。
  let job: DeepResearchJob | null = null;
  try {
    // ① ジョブを作成 (status は default "queued"、最終的に done 化する)。
    job = await repos.deepResearch.insertJob({
      store_id: storeId,
      user_id: session.userId,
    });
    // 以降の try 本体では非 null の jobId を使う (async クロージャ内で job の絞り込みが失われるため)。
    const jobId = job.id;

    // ② Stage 2 構造化。失敗時は concise (簡潔出力 + 増量トークン) で 1 回だけ再試行。
    const structurer = createStructurer();
    const storeContext = {
      name: store.name,
      prefecture: store.prefecture,
      city: store.city,
      address: store.address,
      genre: store.genre,
      site_url: store.site_url,
    };
    let structured = await structurer.structure(
      { reportMarkdown: md, sourceUrls: [], storeContext, concise: false },
      AbortSignal.timeout(STRUCTURE_TIMEOUT_MS),
    );
    if (!structured.ok) {
      structured = await structurer.structure(
        { reportMarkdown: md, sourceUrls: [], storeContext, concise: true },
        AbortSignal.timeout(STRUCTURE_TIMEOUT_MS),
      );
    }

    // ③ レポート組み立て。構造化成功なら 51 項目、失敗なら 8 カテゴリ空配列 + 原文のみ。
    const baseInsert = {
      job_id: jobId,
      store_id: storeId,
      full_markdown: md,
      total_cost_yen: null,
      total_duration_sec: 0,
    };
    let reportInsert: DeepResearchReportInsert;
    let sourceUrls: string[];
    if (structured.ok) {
      const d = structured.data;
      sourceUrls = d.all_source_urls;
      reportInsert = {
        ...baseInsert,
        category_1_basic: d.category_1_basic,
        category_2_owner: d.category_2_owner,
        category_3_menu: d.category_3_menu,
        category_4_customer: d.category_4_customer,
        category_5_marketing: d.category_5_marketing,
        category_6_competitor: d.category_6_competitor,
        category_7_owned_media: d.category_7_owned_media,
        category_8_other: d.category_8_other,
        hearing_questions: d.hearing_questions as HearingQuestion[],
        all_source_urls: sourceUrls,
      };
    } else {
      sourceUrls = [];
      reportInsert = {
        ...baseInsert,
        category_1_basic: [],
        category_2_owner: [],
        category_3_menu: [],
        category_4_customer: [],
        category_5_marketing: [],
        category_6_competitor: [],
        category_7_owned_media: [],
        category_8_other: [],
        hearing_questions: [],
        all_source_urls: [],
      };
    }
    const structuredOk = structured.ok;

    // ④ research_reports 挿入 + job done 化を原子的に行う (pipeline.ts と同型)。
    const completedAt = new Date().toISOString();
    const report = await repos.transaction(async ({ deepResearch }) => {
      const inserted = await deepResearch.insertReport(reportInsert);
      await deepResearch.updateJobStatus(jobId, {
        status: "done",
        completed_at: completedAt,
        // 再構造化のソースとして原文と引用 URL を job にも残す。
        stage1_markdown: md,
        stage1_source_urls: sourceUrls,
      });
      return inserted;
    });

    // ⑤ stage を進める (架電済みは降格させない)。
    const nextStage: StageId =
      store.stage === "架電済み" ? "架電済み" : "DeepResearch済み";
    if (nextStage !== store.stage) {
      await repos.store.update(storeId, { stage: nextStage });
    }

    // ⑥ 関連キャッシュを失効。
    revalidateTag(CACHE_TAGS.deepResearchByStore(storeId), "max");
    revalidateTag(CACHE_TAGS.deepResearchQueue, "max");
    revalidateTag(CACHE_TAGS.stores, "max");
    revalidateTag(CACHE_TAGS.store(storeId), "max");

    return success(
      { jobId, reportId: report.id, structured: structuredOk },
      structuredOk
        ? "構造化して保存しました"
        : "51 項目の構造化に失敗したため原文のみ保存しました。架電生成は実行できます。",
    );
  } catch (err) {
    console.error("[structureFromPastedMarkdownAction] failed", err);
    // 作成済みジョブが queued のまま残ると findActiveByStore が拾い、店舗が恒久的に
    // 「DeepResearching...」表示になる。例外時は failed 化して error_log を残す。
    if (job) {
      try {
        const failedAt = new Date().toISOString();
        await repos.deepResearch.updateJobStatus(job.id, {
          status: "failed",
          completed_at: failedAt,
        });
        await repos.deepResearch.appendJobError(job.id, {
          stage: "stage2",
          kind: "manual_paste_structure_failed",
          message: err instanceof Error ? err.message : String(err),
          occurred_at: failedAt,
        });
      } catch (cleanupErr) {
        // cleanup の二重例外は握り潰し、元エラーのメッセージを優先して返す。
        console.error(
          "[structureFromPastedMarkdownAction] job cleanup failed",
          cleanupErr,
        );
      }
    }
    return failure("構造化結果の保存に失敗しました。時間をおいて再度お試しください。");
  }
}

/**
 * 貼付 Markdown から強み/弱み/グルメ課金/GBP/架電スクリプトを生成する。
 *
 * - 既存 analyzeStoreAction と同じく `buildAnalysisPrompt` → `generateAnalysis`
 *   → `validateAiAnalysis` を通す。入力の HTML スロットに DeepResearch の Markdown 全文を流す。
 * - **生成のみで永続化しない**。編集後の保存はワークベンチが既存 `updateStorePatchAction`
 *   経由で行う (ai_analysis_result と stage を保存)。
 * - 構造化の成否とは独立して実行できる。
 */
export async function generateCallScriptFromMarkdownAction(
  storeId: string,
  markdown: string,
  additionalInstructions?: string,
): Promise<ActionResult<AiAnalysisResult>> {
  if (typeof storeId !== "string" || storeId.trim() === "") {
    return failure("店舗 ID が指定されていません");
  }
  const md = typeof markdown === "string" ? markdown.trim() : "";
  if (md === "") {
    return failure("DeepResearch の結果 Markdown を貼り付けてください");
  }

  const session = await getCurrentSession();
  if (!session) return failure("架電生成にはログインが必要です");

  // レート制限 (AI コスト発生前に防御)。
  const rate = checkRateLimit(storeId);
  if (!rate.ok) return failure(rate.message);

  const store = await repos.store.get(storeId);
  if (!store) return failure("対象店舗が見つかりません");

  // 営業担当の表示名を解決 (架電スクリプト冒頭の発信者名)。未割当時は空文字。
  let assignedSales = "";
  if (store.assigned_sales_user_id) {
    const profile = await repos.profile.findById(store.assigned_sales_user_id);
    assignedSales = profile?.display_name ?? "";
  }

  const { systemPrompt, userParts } = buildAnalysisPrompt({
    formValues: {
      name: store.name,
      prefecture: store.prefecture,
      city: store.city,
      address: store.address,
      genre: store.genre,
      phone: store.phone,
      site_url: store.site_url,
      instagram_url: store.instagram_url,
      map_url: store.map_url,
      review_avg: store.review_avg,
      review_count: store.review_count,
      memo: store.memo,
      operator_type: store.operator_type,
      operator_name: store.operator_name,
    },
    // DeepResearch の Markdown 全文を分析入力として渡す (HTML スロットを転用)。
    htmlContent: md,
    additionalInstructions: (additionalInstructions ?? "").slice(
      0,
      MAX_INSTRUCTIONS_LENGTH,
    ),
    assignedSales,
  });

  const client = createGeminiClient();
  try {
    const raw = await client.generateAnalysis(
      {
        systemPrompt,
        userParts,
        jsonSchema: getAiAnalysisJsonSchema(),
      },
      AbortSignal.timeout(ANALYSIS_TIMEOUT_MS),
    );
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
    if (isAiClientError(err)) {
      return failure(clientErrorToMessage(err));
    }
    return failure("架電生成でエラーが発生しました。再度お試しください。");
  }
}

// ---------------------------------------------------------------------------
// AiClientError 正規化ヘルパ (ai-analysis-actions.ts と同型。SDK 生エラーの漏洩防止)
// ---------------------------------------------------------------------------

function clientErrorToMessage(err: AiClientError): string {
  switch (err.kind) {
    case "missing_api_key":
      return "AI 分析の API キーが未設定です。環境変数 GEMINI_API_KEY を設定してください。";
    case "timeout":
      return "架電生成がタイムアウトしました(60 秒)。再度お試しください。";
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
