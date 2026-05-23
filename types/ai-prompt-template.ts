/**
 * AI プロンプトテンプレート型定義 (Issue #42)
 *
 * - `FewShotExample`: ユーザーが編集可能な Few-shot 例の 1 件分
 * - `AiPromptTemplate`: DB レコードと 1:1 対応するアプリ型
 * - `AiPromptTemplateInput`: insert / update 時の入力型
 * - `parseFewshots` / `serializeFewshots`: body(text) と FewShotExample[] を相互変換
 *
 * 詳細バリデーション(最大 5 件・4000 字制約等)は Phase 2 の Server Actions 側で行う。
 * 本ファイルは型と基本的な parse / serialize に留める。
 */

export interface FewShotExample {
  title: string;
  store_meta: string;
  /** `{ASSIGNED_SALES}` placeholder を含む架電スクリプト例 */
  call_script_ideal: string;
}

export interface AiPromptTemplate {
  id: string;
  user_id: string;
  name: string;
  is_default: boolean;
  /** JSON 文字列: `{ fewshots: FewShotExample[] }` */
  body: string;
  created_at: string;
  updated_at: string;
}

export interface AiPromptTemplateInput {
  name: string;
  is_default: boolean;
  body: string;
}

/**
 * body (JSON 文字列) を FewShotExample[] にパースする。
 * パース失敗・スキーマ不一致の場合は null を返す。
 */
export function parseFewshots(body: string): FewShotExample[] | null {
  try {
    const parsed: unknown = JSON.parse(body);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    const obj = parsed as Record<string, unknown>;
    if (!Array.isArray(obj.fewshots)) return null;
    if (!obj.fewshots.every(isFewShotExample)) return null;
    return obj.fewshots as FewShotExample[];
  } catch {
    return null;
  }
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
 * FewShotExample[] を body (JSON 文字列) にシリアライズする。
 */
export function serializeFewshots(fewshots: FewShotExample[]): string {
  return JSON.stringify({ fewshots });
}
