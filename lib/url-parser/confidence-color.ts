/**
 * 信頼度スコア (0〜100) を背景色 HSL 文字列に変換するヘルパ。
 *
 * グラデーション設計(ユーザー要望に基づく):
 * - 100 → hsl(120) 緑
 * - 80  → hsl(96)  緑黄
 * - 70  → hsl(84)  黄緑
 * - 50  → hsl(60)  黄
 * - 30  → hsl(36)  オレンジ
 * - 0   → hsl(0)   赤
 *
 * 線形補間で連続色を生成する(score / 100 * 120 を hue に充てる)。
 * lightness は 92% で薄く、saturation は 60% で抑えめにし、
 * 入力テキスト (foreground) の可読性を確保する。
 *
 * @param score 0〜100 の信頼度スコア。undefined または NaN は背景色なし。
 * @returns CSS の hsl() 文字列。または undefined(背景色なし)
 */
export function confidenceToBg(score: number | undefined): string | undefined {
  if (typeof score !== "number" || !Number.isFinite(score)) return undefined;
  const clamped = Math.max(0, Math.min(100, score));
  const hue = (clamped / 100) * 120; // 0→0(赤), 100→120(緑)
  return `hsl(${hue.toFixed(0)}, 60%, 92%)`;
}

/**
 * UI のサマリ表示用に信頼度スコアを階層ラベルに変換する。
 * - 81〜100: high
 * - 70〜80:  medium
 * - 50〜69:  low
 * - 0〜49:   very_low
 * - undefined: missing
 */
export type ConfidenceTier = "high" | "medium" | "low" | "very_low" | "missing";

export function confidenceTier(score: number | undefined): ConfidenceTier {
  if (typeof score !== "number" || !Number.isFinite(score)) return "missing";
  if (score >= 81) return "high";
  if (score >= 70) return "medium";
  if (score >= 50) return "low";
  return "very_low";
}
