"use server";

import { parseGoogleMapsUrl } from "@/lib/url-parser/google-maps";
import { fetchOgp } from "@/lib/url-parser/ogp";
import { applyParsedData } from "@/lib/url-parser/apply";
import {
  enrichWithPlacesFallback,
  mergePlaceIntoApply,
  type PlacesFallbackInfo,
} from "@/lib/url-parser/places-fallback";
import {
  evaluateUrlImportPolicy,
  type UrlImportPolicyResult,
  type UrlImportRejectReason,
} from "@/lib/url-parser/url-import-policy";
import { getPlaceById } from "@/lib/places/google";
import { toPlacesDiagnosticKind } from "@/lib/places/errors";
import { buildPlaceIdMapsUrl } from "@/lib/places/maps-url";

/**
 * URL Import から引く Place Details の上限時間。
 *
 * URL Import は Server Action としてユーザーの操作を待たせるため、Places 側が
 * 応答しないときに無制限に待たない。既存の Places 呼び出し
 * (`STAGE0_PLACES_TIMEOUT_MS`) と同じ 15 秒に揃えている。
 * timeout / AbortError は `place_lookup_failed` へ正規化する。
 */
const URL_IMPORT_PLACE_DETAILS_TIMEOUT_MS = 15_000;
import type {
  AppliedField,
  ApplyResult,
  OgpResult,
  ParsedUrl,
} from "@/lib/url-parser/types";

// 型は `@/lib/url-parser/places-fallback` から直接 import すること。
// `"use server"` ファイルから型を re-export すると Next.js 16 + Turbopack が
// 値参照として解釈し、本番ランタイムで ReferenceError を投げる (#11 hotfix)。

/**
 * URL Import の成功結果。`status` による discriminated union にして、
 * 「受け付けなかった」を例外文字列ではなく機械可読な `reason` で返す (Issue #207)。
 */
export interface UrlImportSuccess {
  status: "success";
  /** policy を通過しているため必ず `type: "google_maps"`。 */
  parsed: ParsedUrl;
  /** 短縮 URL の redirect 解決で取得した場合のみ非 null。full place URL では常に null。 */
  ogp: OgpResult | null;
  suggested: ApplyResult;
  /** UI のサマリ表示用 — フィールド別の取得状況 */
  applied: AppliedField[];
  /** Places API フォールバックの実行結果 (呼び出したが補完できなかった場合も info あり) */
  placesFallback?: PlacesFallbackInfo;
}

/**
 * URL Import が URL を受け付けなかった場合。
 * **UI 文言は返さない** — 呼び出し側 (Client Component) が `reason` から文言を決める。
 * Node のエラー文言・HTTP status・raw fetch error は一切載せない。
 */
export interface UrlImportRejected {
  status: "rejected";
  reason: UrlImportRejectReason;
}

export type UrlImportResult = UrlImportSuccess | UrlImportRejected;

// operator_type は URL 解析では法人/個人判別ができないため、表示対象から除外。
// `AppliedField.key` の型と `FIELD_LABELS` のキー集合が同期する。
const FIELD_LABELS: Record<
  Exclude<keyof Omit<ApplyResult, "confidence">, "operator_type">,
  string
> = {
  name: "店舗名",
  prefecture: "都道府県",
  city: "市区町村",
  phone: "電話番号",
  site_url: "公式サイト",
  map_url: "GoogleマップURL",
  instagram_url: "Instagram URL",
  genre: "業態",
  address: "住所",
  review_avg: "口コミ評価",
  review_count: "口コミ件数",
  memo: "メモ",
  operator_name: "運営者",
};

function buildAppliedFields(suggested: ApplyResult): AppliedField[] {
  const c = suggested.confidence;
  const fields: AppliedField[] = [];
  for (const key of Object.keys(FIELD_LABELS) as Array<keyof typeof FIELD_LABELS>) {
    const raw = suggested[key];
    let value: string;
    if (raw === null) {
      value = "";
    } else if (typeof raw === "number") {
      value = String(raw);
    } else {
      value = raw;
    }
    fields.push({
      key,
      label: FIELD_LABELS[key],
      value,
      confidence: c[key],
    });
  }
  return fields;
}

/**
 * success で返す `map_url` が URL Import で**再び受理される**ことを保証する
 * (PR #285 独立確認の指摘)。
 *
 * Places の `googleMapsUri` は `https://maps.google.com/?cid=<数値>` 形式を返し得る。
 * CID は Place ID とは別体系で URL Import が受け付けない形式なので、そのまま
 * `map_url` に採用すると「保存済みの店舗 URL を貼り直すと `not_place_url`」という
 * 自己不整合になる。`stores.map_url` はユーザーがコピーして貼り直す値なので、
 * 受理できない URL を保存しない。
 *
 * `googleMapsUri` が受理可能な形式 (`/maps/place/…` 等) の場合はそのまま活かす。
 * 受理できない場合だけ、policy を通過した URL 由来の値と confidence へ戻す。
 *
 * @param merged Places の値をマージした後の結果
 * @param base URL 由来の値だけで組んだ結果 (map_url は policy 通過済み URL)
 */
function withReimportableMapUrl(merged: ApplyResult, base: ApplyResult): ApplyResult {
  if (merged.map_url !== "" && evaluateUrlImportPolicy(merged.map_url).ok) {
    return merged;
  }
  return {
    ...merged,
    map_url: base.map_url,
    confidence: { ...merged.confidence, map_url: base.confidence.map_url },
  };
}

/**
 * 短縮共有 URL (`maps.app.goo.gl` / `goo.gl/maps`) を展開し、
 * 展開後の URL を **もう一度 policy へ通してから** パースする。
 *
 * ## なぜ再検証するのか
 *
 * 短縮 URL は貼り付け時点では転送先が分からない。
 * `short link → redirect → evil.example` のような経路を店舗 URL として採用しないため、
 * `final_url` は必ず `evaluateUrlImportPolicy` を再通過させ、
 * かつ `google_maps_place`(= 店舗ページ)であることを要求する。
 *
 * redirect 追跡そのものは `fetchOgp` → `safeFetchHtml` が行う。
 * SSRF 防御 (DNS pinning / per-hop deadline / body cap / content-type allowlist) は
 * 一切変更していない。
 *
 * ## 「取得失敗」と「転送先が店舗ページでない」を分ける理由
 *
 * `fetchOgp` は timeout / DNS 解決失敗 / network error / 非 2xx のいずれでも
 * `{ ok: false }` を返す (`lib/url-parser/ogp.ts`)。これらは
 * **転送先が何だったか分かっていない**状態であり、「Google マップの店舗ページでない」
 * とは別事象。両方を `not_place_url` にすると、有効な共有 URL を貼ったユーザーへ
 * 「店舗ページの URL を貼り付けてください」と案内してしまい、貼り直しを繰り返させる。
 * そのため取得失敗は `short_url_resolve_failed` として分離する (PR #211 review)。
 *
 * `ogp.error` (`"タイムアウトしました"` / `"HTTP 500"` 等) は reason へ載せない。
 * サニタイズ済みとはいえ HTTP status を UI へ運ぶ必要が無く、文言は
 * 呼び出し側が `reason` から決める設計を崩さないため。
 */
/** 展開後 URL として受け入れた policy 結果 (短縮 URL の連鎖は含まない)。 */
type ResolvedPlacePolicy = Extract<
  UrlImportPolicyResult,
  { ok: true; kind: "google_maps_place" | "google_maps_place_id" }
>;

async function resolveShortUrl(
  url: string,
): Promise<
  | { ok: true; policy: ResolvedPlacePolicy; ogp: OgpResult }
  | { ok: false; reason: UrlImportRejectReason }
> {
  const ogp = await fetchOgp(url);
  if (!ogp.ok) {
    // 取得・展開そのものに失敗した。転送先が何だったかは判定できていない。
    return { ok: false, reason: "short_url_resolve_failed" };
  }

  const finalUrl = ogp.final_url;
  if (!finalUrl) {
    // 取得はできたが転送が無かった。短縮 URL 単体からは店舗を特定できないため受け付けない。
    return { ok: false, reason: "not_place_url" };
  }

  const policy = evaluateUrlImportPolicy(finalUrl);
  if (!policy.ok) {
    return { ok: false, reason: policy.reason };
  }
  // 短縮 URL の連鎖(short → short)は追わない。最終地点が
  // 「1 店舗を一意特定できる URL」であることを要求する。
  if (policy.kind === "google_maps_short") {
    return { ok: false, reason: "not_place_url" };
  }

  return { ok: true, policy, ogp };
}

/**
 * Place ID が URL に明示されている場合の取得経路 (Issue #207 follow-up)。
 *
 * ## なぜ Text Search を使わないのか
 *
 * URL が Place ID を含んでいる時点で店舗は**一意に確定している**。ここで
 * `enrichWithPlacesFallback` (Text Search) を挟むと、確定済みの identity を
 * 店舗名の文字列照合へ落とすことになり、同名店舗で `ambiguous` になったり
 * 別店舗を引く余地を作る。確定している identity をわざわざ曖昧にしない。
 *
 * API 呼び出しも Place Details 1 回だけで、Text Search との二重呼び出しはしない。
 *
 * ## 失敗時に raw error を UI へ出さない
 *
 * Places の例外は `reason` へ載せず `place_lookup_failed` に潰す。timeout /
 * AbortError / TimeoutError も同じ reason へ正規化する。
 * **この層の**ログには message ではなく `toPlacesDiagnosticKind` の分類値だけを出す。
 *
 * なお下層の Places client (`lib/places/google.ts`) は、非 2xx 応答時に status と
 * redact / clip 済みの body 先頭をサーバーの構造化ログへ記録する既存の observability
 * 設計を持つ。UI / Action の戻り値へ raw body や status が出ないことと、
 * サーバログに診断情報が残ることは両立している。
 *
 * ## `map_url` に `googleMapsUri` を採用しない理由
 *
 * Places の `googleMapsUri` は `https://maps.google.com/?cid=<数値>` 形式を返し得る。
 * CID は Place ID とは別体系で URL Import が受け付けない形式なので、そのまま
 * `map_url` として保存すると「保存済みの店舗 URL を貼り直すと `not_place_url`」という
 * 自己不整合が生まれる (PR #285 独立確認の指摘)。
 *
 * そこで取得できた `placeId` / `name` から **Google Maps URLs の公式 Search 形式**
 * (`?api=1&query=<店名>&query_place_id=<ID>`) を組み立て直して `map_url` にする。
 * これで次を同時に満たす:
 *
 * - 公式仕様の必須項目 `query` を満たす
 * - Place ID で 1 店舗を一意特定できる
 * - CID 形式へ戻らない
 * - `evaluateUrlImportPolicy` で再び受理される (round-trip invariant)
 *
 * 短縮 URL 経由でも同じ canonical URL へ正規化する。
 * ただし `source_url` は**ユーザーが実際に貼った URL のまま**保持する。
 */
async function importFromPlaceId(
  placeId: string,
  sourceUrl: string,
  ogp: OgpResult | null,
): Promise<UrlImportResult> {
  let place;
  try {
    place = await getPlaceById(placeId, {
      timeoutMs: URL_IMPORT_PLACE_DETAILS_TIMEOUT_MS,
    });
  } catch (e) {
    console.warn(`[url-import] place details failed: ${toPlacesDiagnosticKind(e)}`);
    return { status: "rejected", reason: "place_lookup_failed" };
  }
  if (!place) {
    // 2xx だが必須フィールドが欠けている。店舗として扱える情報が無い。
    console.warn("[url-import] place details returned no usable place");
    return { status: "rejected", reason: "place_lookup_failed" };
  }

  // name / address / phone 等はすべて Places 由来にする。URL 文字列からは
  // 何も読み取らない (`?q=place_id:…` を店舗名として採用しないため)。
  // `map_url` は取得結果から公式形式へ正規化する (上記のとおり)。
  const parsed: ParsedUrl = {
    type: "google_maps",
    source_url: sourceUrl,
    map_url: buildPlaceIdMapsUrl(place.placeId, place.name),
    confidence: {},
  };
  const base = applyParsedData(parsed, null);
  const suggested = withReimportableMapUrl(mergePlaceIntoApply(base, place), base);

  return {
    status: "success",
    parsed,
    ogp,
    suggested,
    applied: buildAppliedFields(suggested),
    placesFallback: {
      used: true,
      reason: "place_id_url",
      matched_place_id: place.placeId,
    },
  };
}

/**
 * `/stores/new` の URL Import 本体 (Issue #207 で Google マップ店舗 URL 専用へ変更)。
 *
 * ## server 側での boundary 強制
 *
 * UI 側のバリデーションだけに頼らず、**この関数の冒頭でも policy を検証する**。
 * 受け付けない URL に対しては `fetchOgp` / Places API を**一切呼ばない**ため、
 * 食べログ URL を送っても Vercel → `tabelog.com` のリクエスト自体が発生しない。
 *
 * これにより Issue #207 の 2 つの経路が構造的に消える:
 * - `tabelog.com` への取得 → Cloudflare 403 → 店舗名が空のまま登録画面へ
 * - `google.com/search` の `<title>Google Search</title>` が店舗名として採用される
 *
 * ## full place URL で OGP を取得しない理由
 *
 * Google マップのページは SPA で、`<title>` は「Google マップ」固定のため
 * 店舗情報ソースとして価値が無い(`pickName` も google_maps では URL 由来 name を
 * 優先しており、OGP 由来 name は元々採用されない)。
 * `OgpResult.html` の消費者だった `analyzeStoreAction` も既に撤去済みで、
 * 現在 `html` を読むコードは存在しない。
 * したがって full place URL では HTTP リクエストを 0 回にする。
 * 短縮 URL のみ、redirect 解決のために `fetchOgp` を 1 回呼ぶ。
 *
 * ## パーサに `parseStoreUrl` を使わない理由
 *
 * `parseStoreUrl` は `url.includes("google.com/maps")` 等の**部分文字列**でソースを
 * 分類する汎用ディスパッチャで、`google.co.jp/maps/place/…` を `unknown` に落とす。
 * policy(hostname/pathname)と分類基準が異なるため、両者を直列に使うと
 * 「policy は受理したのにパーサが別種別を返して拒否される」という drift が生じる。
 * 受付可否は policy が唯一の source of truth なので、通過後は
 * `parseGoogleMapsUrl` を直接呼ぶ。
 */
export async function importFromUrlAction(url: string): Promise<UrlImportResult> {
  const policy = evaluateUrlImportPolicy(url);
  if (!policy.ok) {
    return { status: "rejected", reason: policy.reason };
  }

  // 短縮 URL は展開し、展開後 URL を再検証した結果で以降を分岐する。
  // ソース情報 (ユーザーが実際に貼った URL) は `sourceUrl` として保持する。
  const sourceUrl = policy.url;
  let effective: ResolvedPlacePolicy;
  let ogp: OgpResult | null = null;

  if (policy.kind === "google_maps_short") {
    const resolved = await resolveShortUrl(policy.url);
    if (!resolved.ok) return { status: "rejected", reason: resolved.reason };
    effective = resolved.policy;
    ogp = resolved.ogp;
  } else {
    effective = policy;
  }

  // Place ID が取れている場合は曖昧な Text Search を挟まず Place Details を直接引く。
  if (effective.kind === "google_maps_place_id") {
    return importFromPlaceId(effective.placeId, sourceUrl, ogp);
  }

  // `map_url` は展開後の URL を採用 — 後で開いたときに直接 Google マップへ行ける。
  const parsed: ParsedUrl = { ...parseGoogleMapsUrl(effective.url), source_url: sourceUrl };

  const base = applyParsedData(parsed, ogp);

  // Places API フォールバック: 低信頼度フィールドが残っている場合に Text Search 1 回で補完。
  // API キー未設定 / ネットワーク例外時は silently skip する。
  const placesResult = await enrichWithPlacesFallback(parsed, base);
  // 補完結果の googleMapsUri が受理できない形式 (CID) でも、再 import できる URL を保つ。
  const suggested = withReimportableMapUrl(placesResult.updated, base);
  const placesFallback = placesResult.info;

  const applied = buildAppliedFields(suggested);
  return { status: "success", parsed, ogp, suggested, applied, placesFallback };
}
