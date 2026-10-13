/**
 * 店舗名の先頭に書き込まれた営業メモの検出 (#297)。
 *
 * 営業結果を一覧で見分ける手段が無かったため、現場は
 * `（Rアポハマロスト）炉端ジュン` / `（確バツ）おゆげ 自由が丘` / `（7月24日NEW）Bistro Norc`
 * のように店舗名の先頭へ括弧書きでメモを入れていた。店舗名の検索・並び替え・
 * AI 調査の屋号照合・架電スクリプトの店名差し込みにノイズが混ざるので、
 * 営業記録 (失注理由・再アプローチ) や顧客共有メモへ移すための検出だけを担う。
 *
 * 書き換えはしない。何をどこへ移すかは人が判断する
 * (「Rアポ」は再アプローチ可、「3月OPen」は開業日、のように行き先が一定しない)。
 *
 * DB や `server-only` に依存しない純関数 (scripts/ からも読み込むため)。
 */

/** 先頭の括弧書き 1 個。全角・半角・隅付き・角括弧の組み合わせ違いも拾う。 */
const LEADING_BRACKET = /^\s*[（(【［[]([^（()）【】［\][\]]+)[）)】］\]]\s*/;

/**
 * 法人格の略記。`(株)サンプル` は営業メモではなく正式な屋号の一部なので除外する。
 */
const LEGAL_ENTITY_ABBREVIATIONS = new Set([
  "株", "有", "合", "名", "資", "同", "社", "財", "医", "宗", "学", "福", "特非",
  "一社", "一財", "公社", "公財", "NPO",
]);

export interface StoreNameMemo {
  /** 括弧の中身。複数並んでいれば出現順に「 / 」で連結する。 */
  memo: string;
  /** メモを取り除いた店舗名の候補。 */
  name: string;
}

/**
 * 店舗名の先頭にある括弧書きメモを取り出す。メモが無ければ null。
 *
 * - 先頭に連続する括弧書きはまとめて取る (`（Rアポ）（3月OPen）店名`)
 * - 取り除くと店舗名が空になる場合は null (括弧書きそのものが屋号)
 * - 法人格の略記 (`(株)` 等) はメモとみなさない
 */
export function splitStoreNameMemo(name: string): StoreNameMemo | null {
  const memos: string[] = [];
  let rest = name;
  for (;;) {
    const match = LEADING_BRACKET.exec(rest);
    if (!match) break;
    const inner = match[1]!.trim();
    if (LEGAL_ENTITY_ABBREVIATIONS.has(inner)) break;
    if (inner) memos.push(inner);
    rest = rest.slice(match[0].length);
  }
  const cleaned = rest.trim();
  if (memos.length === 0 || cleaned === "") return null;
  return { memo: memos.join(" / "), name: cleaned };
}
