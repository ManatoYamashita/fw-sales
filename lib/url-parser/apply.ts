import type {
  ApplyConfidence,
  ApplyResult,
  OgpResult,
  ParsedSource,
  ParsedUrl,
} from "./types";

const PREFECTURE_PATTERN =
  /(東京都|大阪府|京都府|北海道|.+?[都道府県])/;

/**
 * 信頼度スコア(0〜100)。types.ts の ApplyConfidence コメントと整合する。
 */
const SCORE = {
  TABELOG_DICT: 95, // 食べログ辞書: prefecture / city
  JSON_LD: 90, // JSON-LD Restaurant schema 由来
  TABELOG_HTML: 85, // 食べログ HTML 構造化セレクタ
  URL_DIRECT: 80, // URL 直接抽出 (station_area, name)
  OGP_TITLE: 75, // OGP og:title / canonical / Google Maps URL の name
  GENRE_GUESS: 60, // OGP description 由来の genre 推定
  GMAPS_QUERY: 50, // Google Maps URL の ?q= 由来
} as const;

/**
 * OGP の name 値が「ジェネリックなサイトタイトル」(店舗名ではない)である場合の判定。
 */
const NAME_BLACKLIST: readonly string[] = [
  "Google マップ",
  "Google Maps",
  "Googleマップ",
  "食べログ",
  "Tabelog",
];

function isBlacklistedName(name: string): boolean {
  const trimmed = name.trim();
  if (!trimmed) return true;
  return NAME_BLACKLIST.some((bad) => trimmed === bad);
}

interface PickNameResult {
  value: string;
  source: "parsed" | "ogp" | "none";
}

/**
 * URL 由来の name と OGP 由来の name の優先度を解決する。
 * 戻り値はソース付きで、信頼度スコア決定のために caller が source を見る。
 */
export function pickName(
  parsedName: string | undefined,
  ogpName: string | undefined,
  parsedType: ParsedSource | undefined,
): PickNameResult {
  const parsed = (parsedName ?? "").trim();
  const ogp = (ogpName ?? "").trim();

  const ogpClean = ogp && !isBlacklistedName(ogp) ? ogp : "";

  // Google Maps は URL 由来を優先(OGP の <title> は "Google マップ" 固定で汚染源)
  if (parsedType === "google_maps") {
    if (parsed) return { value: parsed, source: "parsed" };
    if (ogpClean) return { value: ogpClean, source: "ogp" };
    return { value: "", source: "none" };
  }

  // それ以外は OGP > parsed
  if (ogpClean) return { value: ogpClean, source: "ogp" };
  if (parsed) return { value: parsed, source: "parsed" };
  return { value: "", source: "none" };
}

/**
 * ParsedUrl.confidence (`"high" | "medium" | "low"`) を 0〜100 のスコアに変換。
 */
function levelToScore(level: "high" | "medium" | "low" | undefined): number {
  if (level === "high") return SCORE.TABELOG_DICT;
  if (level === "medium") return SCORE.OGP_TITLE;
  if (level === "low") return SCORE.GMAPS_QUERY;
  return SCORE.URL_DIRECT;
}

export function applyParsedData(
  parsed: ParsedUrl | null,
  ogp: OgpResult | null = null,
): ApplyResult {
  const confidence: ApplyConfidence = {};
  const fields: ApplyResult = {
    name: "",
    prefecture: "",
    city: "",
    phone: "",
    site_url: "",
    map_url: "",
    instagram_url: "",
    genre: "",
    address: "",
    review_avg: null,
    review_count: null,
    memo: "",
    operator_type: "未設定",
    operator_name: "",
    confidence,
  };

  // ---- ParsedUrl 由来 ----
  if (parsed) {
    if (parsed.prefecture) {
      fields.prefecture = parsed.prefecture;
      confidence.prefecture = levelToScore(parsed.confidence.prefecture);
    }
    if (parsed.city) {
      fields.city = parsed.city;
      confidence.city = levelToScore(parsed.confidence.city);
    }
    if (parsed.genre) {
      fields.genre = parsed.genre;
      confidence.genre = levelToScore(parsed.confidence.genre);
    }
    if (parsed.map_url) {
      fields.map_url = parsed.map_url;
      confidence.map_url = SCORE.URL_DIRECT;
    }
    if (parsed.instagram_url) {
      fields.instagram_url = parsed.instagram_url;
      confidence.instagram_url = SCORE.URL_DIRECT;
    }
    // station_area は address のフォールバック(後段で OGP の詳細住所がなかった時のみ採用)
    if (parsed.tabelog_url) {
      fields.memo = `食べログURL: ${parsed.tabelog_url}`;
      confidence.memo = SCORE.URL_DIRECT;
    }
  }

  // ---- OGP 由来 ----
  if (ogp?.ok) {
    if (ogp.genre && !fields.genre) {
      fields.genre = ogp.genre;
      confidence.genre = SCORE.GENRE_GUESS;
    }
    if (ogp.phone) {
      fields.phone = ogp.phone;
      // JSON-LD or 食べログ DOM 由来 → 高め、OGP 正規表現フォールバック → 中
      confidence.phone = ogp.address ? SCORE.JSON_LD : SCORE.TABELOG_HTML;
    }
    if (typeof ogp.rating === "number") {
      fields.review_avg = ogp.rating;
      confidence.review_avg = ogp.address ? SCORE.JSON_LD : SCORE.TABELOG_HTML;
    }
    if (typeof ogp.review_count === "number") {
      fields.review_count = ogp.review_count;
      confidence.review_count = ogp.address ? SCORE.JSON_LD : SCORE.TABELOG_HTML;
    }
    if (ogp.address && !fields.address) {
      fields.address = ogp.address;
      confidence.address = SCORE.JSON_LD;
    }
    if (ogp.address_hint && !fields.prefecture) {
      const m = ogp.address_hint.match(PREFECTURE_PATTERN);
      if (m?.[1]) {
        fields.prefecture = m[1];
        confidence.prefecture = SCORE.OGP_TITLE;
      }
    }
    if (ogp.site_url && !fields.site_url) {
      fields.site_url = ogp.site_url;
      confidence.site_url = SCORE.JSON_LD;
    }
    if (ogp.description && parsed?.type === "tabelog") {
      const tail = `概要: ${ogp.description.slice(0, 100)}`;
      fields.memo = fields.memo ? `${fields.memo}\n${tail}` : tail;
      // memo は既に URL_DIRECT スコア。description で追記しても下げない
    }
    // 運営者(法人名 / 個人オーナー名)を反映。
    // 取得元に応じて信頼度を変える: JSON-LD = 90、食べログ DOM = 85。
    // operator_type は URL 解析だけでは法人/個人判別が難しいため "未設定" を維持し、
    // LLM 推定 (Phase 4 以降の analyzeStoreAction) または手動編集に委ねる。
    if (ogp.operator && !fields.operator_name) {
      fields.operator_name = ogp.operator.value;
      confidence.operator_name =
        ogp.operator.source === "json_ld"
          ? SCORE.JSON_LD
          : SCORE.TABELOG_HTML;
    }
  }

  // ---- address のフォールバック: parsed.station_area ----
  // OGP / JSON-LD で詳細住所が取れていれば address は埋まっているのでスキップ
  if (!fields.address && parsed?.station_area) {
    fields.address = `${parsed.station_area}周辺`;
    confidence.address = SCORE.URL_DIRECT;
  }

  // ---- name は最後に優先度ルールで決定 ----
  const nameResult = pickName(
    parsed?.name,
    ogp?.ok ? ogp.name : undefined,
    parsed?.type,
  );
  fields.name = nameResult.value;
  if (nameResult.source === "parsed" && parsed?.confidence.name) {
    confidence.name = levelToScore(parsed.confidence.name);
  } else if (nameResult.source === "parsed") {
    confidence.name = SCORE.URL_DIRECT;
  } else if (nameResult.source === "ogp") {
    confidence.name = SCORE.OGP_TITLE;
  }

  return fields;
}
