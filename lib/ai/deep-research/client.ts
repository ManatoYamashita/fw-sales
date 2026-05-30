/**
 * Gemini Deep Research Stage 1 SDK ラッパ (deep-research-pipeline spec, Issue #43, Task 2.2)
 *
 * `@google/genai@1.52.0` の `client.interactions` API を抽象化する。
 *
 * SDK API surface (`node_modules/@google/genai/dist/genai.d.ts` から確認済):
 * - `client.interactions.create({ agent, input, system_instruction?, background?, ... })`
 *   → `Promise<Interaction>` (Interaction.id を返す)
 * - `client.interactions.get(id)` → `Promise<Interaction>`
 * - `client.interactions.cancel(id)` → `Promise<Interaction>`
 * - `Interaction.status`: 'in_progress' | 'requires_action' | 'completed' | 'failed' | 'cancelled' | 'incomplete'
 * - `Interaction.outputs?: Array<Content>` — Markdown は `text` type の Content に格納
 * - `Annotation.url_citation` で引用 URL を抽出
 *
 * 設計上の判断:
 * - `taskName` (design.md) → `taskId` (SDK 用語) に変更。DB 列 `deep_research_task_id` と整合
 * - `requires_action` は当面 Stage 1 が単発 Web リサーチのみなので `in_progress` 扱い
 *   (将来 human-in-the-loop プランニングを使う際に再設計)
 * - `cancelled` / `incomplete` は呼出側の意図の有無で意味が変わるが、本ラッパでは
 *   完了状態として扱わない (`failed` に正規化、ジョブログに状態を残す)
 *
 * 関連: design.md §Components and Interfaces / DeepResearchClient,
 *       requirements.md §3.1, §3.6, §5.4, §6.6
 */

import "server-only";

import { GoogleGenAI, Interactions } from "@google/genai";
import { readEnv, getDeepResearchModel } from "@/lib/env";

// SDK では型シンボルが Interactions namespace 配下に再 export されるのみ。
// alias 化して保守時の追跡性を確保。
type Interaction = Interactions.Interaction;
type Content = Interactions.Content;
type TextContent = Interactions.TextContent;
type Annotation = Interactions.Annotation;

export type DeepResearchClientError =
  | { kind: "missing_api_key" }
  | { kind: "timeout" }
  | { kind: "rate_limit"; retryAfterSeconds?: number; message?: string }
  | { kind: "auth_error"; message?: string }
  | { kind: "api_error"; status: number; message?: string }
  | { kind: "network_error"; message?: string }
  | { kind: "not_found"; message?: string }
  | { kind: "unknown"; message: string };

export interface DeepResearchTaskHandle {
  taskId: string;
}

export type DeepResearchTaskState =
  | { state: "in_progress"; apiUpdatedAt?: string }
  | {
      state: "completed";
      reportMarkdown: string;
      sourceUrls: string[];
      tokenUsage?: { promptTokens: number; outputTokens: number };
      apiUpdatedAt?: string;
    }
  | { state: "failed"; reason: string };

export type DeepResearchCancelResult =
  | { cancelled: true }
  | { cancelled: false; reason: "unsupported" | "already_terminal" | "api_error" };

export interface DeepResearchClient {
  startTask(
    input: { systemPrompt: string; userPrompt: string },
    signal: AbortSignal,
  ): Promise<DeepResearchTaskHandle>;

  getTask(
    handle: DeepResearchTaskHandle,
    signal: AbortSignal,
  ): Promise<DeepResearchTaskState>;

  cancelTask(
    handle: DeepResearchTaskHandle,
    signal: AbortSignal,
  ): Promise<DeepResearchCancelResult>;
}

/**
 * `DeepResearchClient` のデフォルト実装。各呼出ごとに `GoogleGenAI` インスタンスを
 * 生成する (既存 `lib/ai/client.ts` と同じ判断、MVP は singleton 化しない)。
 */
export function createDeepResearchClient(): DeepResearchClient {
  return {
    async startTask(input, signal) {
      const apiKey = readEnv("GEMINI_API_KEY");
      if (!apiKey) {
        throw makeError({ kind: "missing_api_key" });
      }
      const ai = new GoogleGenAI({ apiKey });
      try {
        // `client.interactions.create` を非同期 (background:true) で投入。
        // signal は SDK の RequestOptions.signal 経由で AbortController を渡す。
        const interaction = (await ai.interactions.create(
          {
            agent: getDeepResearchModel(),
            input: input.userPrompt,
            system_instruction: input.systemPrompt,
            background: true,
          },
          { signal },
        )) as Interaction;
        if (!interaction.id) {
          throw makeError({
            kind: "unknown",
            message: "Deep Research タスク投入後の応答に id が含まれませんでした",
          });
        }
        return { taskId: interaction.id };
      } catch (err) {
        throw normalizeSdkError(err);
      }
    },

    async getTask(handle, signal) {
      const apiKey = readEnv("GEMINI_API_KEY");
      if (!apiKey) {
        throw makeError({ kind: "missing_api_key" });
      }
      const ai = new GoogleGenAI({ apiKey });
      try {
        const interaction = (await ai.interactions.get(handle.taskId, undefined, {
          signal,
        })) as Interaction;
        return mapInteractionToState(interaction);
      } catch (err) {
        throw normalizeSdkError(err);
      }
    },

    async cancelTask(handle, signal) {
      const apiKey = readEnv("GEMINI_API_KEY");
      if (!apiKey) {
        return { cancelled: false, reason: "api_error" };
      }
      const ai = new GoogleGenAI({ apiKey });
      try {
        await ai.interactions.cancel(handle.taskId, undefined, { signal });
        return { cancelled: true };
      } catch (err) {
        const normalized = normalizeSdkError(err);
        if (normalized.kind === "not_found") {
          return { cancelled: false, reason: "already_terminal" };
        }
        return { cancelled: false, reason: "api_error" };
      }
    },
  };
}

/**
 * `Interaction.status` を本ラッパの公開状態に正規化する純関数。テストから直接呼べる。
 */
export function mapInteractionToState(
  interaction: Interaction,
): DeepResearchTaskState {
  const apiUpdatedAt =
    (interaction as unknown as Record<string, unknown>).updated as
      | string
      | undefined;

  switch (interaction.status) {
    case "in_progress":
    case "requires_action":
      return { state: "in_progress", apiUpdatedAt };
    case "completed": {
      const { reportMarkdown, sourceUrls } = extractMarkdownAndUrls(
        interaction.outputs,
      );
      const tokenUsage = extractTokenUsage(interaction);
      const result: DeepResearchTaskState = {
        state: "completed",
        reportMarkdown,
        sourceUrls,
        apiUpdatedAt,
      };
      if (tokenUsage) {
        result.tokenUsage = tokenUsage;
      }
      return result;
    }
    case "failed":
    case "cancelled":
    case "incomplete":
    default:
      return {
        state: "failed",
        reason: `Deep Research タスクが ${interaction.status ?? "unknown"} 状態で終了しました`,
      };
  }
}

/**
 * `Interaction.outputs` から Markdown 全文と引用 URL 配列を抽出する。
 *
 * - text 型の Content から `text` を連結し Markdown とする
 * - 各 `TextContent.annotations` の `url_citation` から URL を重複排除して収集
 */
function extractMarkdownAndUrls(
  outputs: Interaction["outputs"] | undefined,
): { reportMarkdown: string; sourceUrls: string[] } {
  if (!outputs || outputs.length === 0) {
    return { reportMarkdown: "", sourceUrls: [] };
  }
  const textParts: string[] = [];
  const urls = new Set<string>();
  for (const content of outputs) {
    collectFromContent(content, textParts, urls);
  }
  return {
    reportMarkdown: textParts.join("\n\n").trim(),
    sourceUrls: [...urls],
  };
}

/**
 * `Content_2` は union 型のため、テキストと注釈 URL を再帰的に拾うヘルパ。
 * 既知の `text` フィールドを持つものはここから抽出。
 */
function collectFromContent(
  content: Content | TextContent | unknown,
  textParts: string[],
  urls: Set<string>,
): void {
  if (typeof content !== "object" || content === null) return;
  const obj = content as Record<string, unknown>;

  // TextContent: { type: 'text', text: string, annotations?: Annotation[] }
  if (obj.type === "text" && typeof obj.text === "string") {
    textParts.push(obj.text);
    if (Array.isArray(obj.annotations)) {
      for (const a of obj.annotations as Annotation[]) {
        collectUrlsFromAnnotation(a, urls);
      }
    }
    return;
  }

  // Content_2 が parts を持つ集約型なら再帰
  if (Array.isArray(obj.parts)) {
    for (const part of obj.parts) {
      collectFromContent(part, textParts, urls);
    }
  }
}

function collectUrlsFromAnnotation(
  annotation: Annotation,
  urls: Set<string>,
): void {
  const a = annotation as unknown as Record<string, unknown>;
  if (a.type === "url_citation" && typeof a.url === "string" && a.url.length > 0) {
    urls.add(a.url);
  }
}

function extractTokenUsage(
  interaction: Interaction,
): { promptTokens: number; outputTokens: number } | undefined {
  const usage = interaction.usage;
  if (!usage) return undefined;
  const promptTokens =
    typeof usage.total_input_tokens === "number"
      ? usage.total_input_tokens
      : undefined;
  const outputTokens =
    typeof usage.total_output_tokens === "number"
      ? usage.total_output_tokens
      : undefined;
  if (promptTokens === undefined && outputTokens === undefined) return undefined;
  return {
    promptTokens: promptTokens ?? 0,
    outputTokens: outputTokens ?? 0,
  };
}

/**
 * SDK 生エラーを `DeepResearchClientError` に正規化する。
 *
 * 既存 `lib/ai/client.ts` の同名関数と同型ロジック (API キー値・request ID の
 * 漏洩防止)。Deep Research 固有として `not_found` を追加 (cancel 時の
 * already-terminal 判定に使用)。
 *
 * 各分岐で SDK の生メッセージを `sanitizeMessage` 経由で保持し、`error_log` に
 * Gemini からの応答 body を残せるようにする (R6.6: API キー値・request ID は
 * `redactSecrets` で `***` 置換)。
 */
function normalizeSdkError(err: unknown): DeepResearchClientError {
  if (isDeepResearchClientError(err)) {
    return err;
  }
  if (err instanceof DOMException && err.name === "AbortError") {
    return { kind: "timeout" };
  }
  if (err instanceof TypeError && err.message.toLowerCase().includes("fetch")) {
    return { kind: "network_error", message: sanitizeMessage(err.message) };
  }
  if (err instanceof Error) {
    // @google/genai の `ApiError` は `status: number` を直接持つため、
    // regex でメッセージから推定するより `err.status` を優先する。
    const apiErr = err as Error & { status?: unknown; name?: string };
    if (
      (apiErr.name === "ApiError" || "status" in apiErr) &&
      typeof apiErr.status === "number"
    ) {
      const status = apiErr.status;
      const message = sanitizeMessage(err.message);
      if (status === 401 || status === 403) {
        return { kind: "auth_error", message };
      }
      if (status === 404) {
        return { kind: "not_found", message };
      }
      if (status === 429) {
        return { kind: "rate_limit", message };
      }
      return { kind: "api_error", status, message };
    }
    const msg = err.message.toLowerCase();
    if (
      msg.includes("404") ||
      msg.includes("not found") ||
      msg.includes("not_found")
    ) {
      return { kind: "not_found", message: sanitizeMessage(err.message) };
    }
    if (
      msg.includes("401") ||
      msg.includes("unauthorized") ||
      msg.includes("api key")
    ) {
      return { kind: "auth_error", message: sanitizeMessage(err.message) };
    }
    if (
      msg.includes("429") ||
      msg.includes("rate limit") ||
      msg.includes("quota")
    ) {
      return { kind: "rate_limit", message: sanitizeMessage(err.message) };
    }
    const statusMatch = err.message.match(/\b([45]\d\d)\b/);
    if (statusMatch && statusMatch[1] !== undefined) {
      const status = Number.parseInt(statusMatch[1], 10);
      if (Number.isFinite(status)) {
        return {
          kind: "api_error",
          status,
          message: sanitizeMessage(err.message),
        };
      }
    }
    return {
      kind: "unknown",
      message: sanitizeMessage(err.message),
    };
  }
  return {
    kind: "unknown",
    message: "Deep Research API 呼出で不明なエラーが発生しました",
  };
}

/**
 * SDK エラーメッセージを `error_log` に保存する前段で
 * (1) 既知シークレットを `***` に置換し、(2) 800 字でカットする。
 *
 * 置換対象:
 * - 環境変数 `GEMINI_API_KEY` の実値
 * - Google API キーの典型パターン `AIza[\w-]{20,}`
 * - HTTP 認可ヘッダ `Bearer <token>`
 * - OpenAI 形式トークン `sk-[\w-]{20,}`
 */
function sanitizeMessage(raw: string, maxLen = 800): string {
  let out = raw;
  const key = process.env.GEMINI_API_KEY;
  if (key && key.length >= 4) {
    out = out.split(key).join("***");
  }
  out = out.replace(/AIza[\w-]{20,}/g, "AIza***");
  out = out.replace(/Bearer\s+[\w.\-+/=]+/gi, "Bearer ***");
  out = out.replace(/sk-[\w-]{20,}/g, "sk-***");
  return out.length <= maxLen ? out : `${out.slice(0, maxLen)}…(truncated)`;
}

function makeError(err: DeepResearchClientError): DeepResearchClientError {
  return err;
}

function isDeepResearchClientError(
  err: unknown,
): err is DeepResearchClientError {
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
    kind === "not_found" ||
    kind === "unknown"
  );
}
