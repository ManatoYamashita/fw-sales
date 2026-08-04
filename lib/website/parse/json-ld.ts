/**
 * JSON-LD 解析(Plan v1.1 §8、契約 §B.4.2）。generic first-party parser の一部。
 * Tabelog 等 portal 専用の selector は一切持たない。
 *
 * JSON 構造を **bounded** に再帰走査し、以下を分離する:
 * - `allTypes`: ページ内で宣言された全 `@type`(technical signal、`website_jsonld_types`）
 * - `identityNodes`: 店舗 entity を記述する node のみ(identity evidence の供給源）
 *
 * identity node として認めるのは strong(店舗 entity 系）と weak(Organization）のみ。
 * BreadcrumbList / WebSite / WebPage 等は `allTypes` には含まれるが `identityNodes` には
 * 含まれない(たとえ `name` フィールドを持っていても、店舗名として扱わない）。
 *
 * 走査は `@graph` に限らず、`mainEntity` / `about` / `subjectOf` / `itemListElement` 等
 * 任意の property の中にネストした node も対象にする。property 名を hard-code せず
 * JSON の object/array を一般に walk するため、未知の埋め込み方にも追随する。
 * 入力は外部サイトの HTML であるため、病的な JSON-LD に対する上限
 * (`MAX_JSONLD_NODES` / `MAX_JSONLD_DEPTH`）を設ける。上限超過分は無視するだけで、
 * ページ全体の解析は失敗させない。
 */

import type { CheerioAPI } from "cheerio";

export const STRONG_ENTITY_TYPES = [
  "Restaurant",
  "FoodEstablishment",
  "LocalBusiness",
  "BarOrPub",
  "CafeOrCoffeeShop",
  "Bakery",
  "NightClub",
] as const;

export const WEAK_ENTITY_TYPES = ["Organization"] as const;

/**
 * identity evidence から明示的に除外する `@type`(契約 §B.4.2）。
 * ドキュメント・テスト用の参照値であり、除外自体は STRONG/WEAK の allow-list により
 * 実現される(この配列に無い型は自動的に除外される）。
 */
export const EXCLUDED_IDENTITY_TYPES = [
  "BreadcrumbList",
  "WebSite",
  "WebPage",
  "Article",
  "BlogPosting",
  "SiteNavigationElement",
  "ItemList",
  "SearchAction",
  "Person",
  "Product",
  "Event",
] as const;

/** 走査する JSON node 数の上限(病的入力への防御）。 */
export const MAX_JSONLD_NODES = 2000;
/** 走査するネスト深さの上限(病的入力への防御）。 */
export const MAX_JSONLD_DEPTH = 20;

export interface JsonLdIdentityNode {
  strength: "strong" | "weak";
  name: string | null;
  address: string | null;
  telephone: string | null;
  sameAs: string[];
}

export interface ParsedJsonLdDocument {
  allTypes: string[];
  identityNodes: JsonLdIdentityNode[];
  /** 上限に達して走査を打ち切ったか(観測の網羅性が保証されないことの表明）。 */
  truncated: boolean;
}

interface RawPostalAddress {
  streetAddress?: unknown;
  addressLocality?: unknown;
  addressRegion?: unknown;
  postalCode?: unknown;
}

function asNonEmptyString(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

function composeAddress(addr: unknown): string | null {
  const asString = asNonEmptyString(addr);
  if (asString) return asString;
  if (addr && typeof addr === "object") {
    const a = addr as RawPostalAddress;
    const postalCode = asNonEmptyString(a.postalCode);
    const parts = [
      postalCode ? `〒${postalCode}` : null,
      asNonEmptyString(a.addressRegion),
      asNonEmptyString(a.addressLocality),
      asNonEmptyString(a.streetAddress),
    ].filter((x): x is string => x !== null);
    return parts.length > 0 ? parts.join(" ") : null;
  }
  return null;
}

function typesOf(node: Record<string, unknown>): string[] {
  const t = node["@type"];
  if (typeof t === "string") return [t];
  if (Array.isArray(t)) return t.filter((x): x is string => typeof x === "string");
  return [];
}

function sameAsOf(node: Record<string, unknown>): string[] {
  const s = node["sameAs"];
  if (typeof s === "string") return [s];
  if (Array.isArray(s)) return s.filter((x): x is string => typeof x === "string");
  return [];
}

function classifyStrength(types: readonly string[]): "strong" | "weak" | null {
  if (types.some((t) => (STRONG_ENTITY_TYPES as readonly string[]).includes(t))) return "strong";
  if (types.some((t) => (WEAK_ENTITY_TYPES as readonly string[]).includes(t))) return "weak";
  return null;
}

interface WalkState {
  allTypes: string[];
  identityNodes: JsonLdIdentityNode[];
  visitedNodes: number;
  truncated: boolean;
}

/**
 * JSON 値を一般に walk する。object の全 property・array の全要素を辿るため、
 * `@graph` / `mainEntity` / `about` / `itemListElement` 等どこにネストしていても
 * `@type` 付き node を発見できる。node 数・深さの上限に達したらそこで打ち切る。
 */
function walk(node: unknown, depth: number, state: WalkState): void {
  if (state.visitedNodes >= MAX_JSONLD_NODES) {
    state.truncated = true;
    return;
  }
  if (depth > MAX_JSONLD_DEPTH) {
    state.truncated = true;
    return;
  }

  if (Array.isArray(node)) {
    state.visitedNodes++;
    for (const item of node) walk(item, depth + 1, state);
    return;
  }
  if (!node || typeof node !== "object") return;

  state.visitedNodes++;
  const obj = node as Record<string, unknown>;
  const types = typesOf(obj);
  state.allTypes.push(...types);

  const strength = classifyStrength(types);
  if (strength !== null) {
    state.identityNodes.push({
      strength,
      name: asNonEmptyString(obj["name"]),
      address: composeAddress(obj["address"]),
      telephone: asNonEmptyString(obj["telephone"]),
      sameAs: sameAsOf(obj),
    });
  }

  for (const key of Object.keys(obj)) {
    // `@type` は上で処理済み。`address` は composeAddress が構造ごと解釈するため、
    // PostalAddress を独立 node として二重に数えない。
    if (key === "@type" || key === "address") continue;
    walk(obj[key], depth + 1, state);
  }
}

function dedupe(arr: readonly string[]): string[] {
  return [...new Set(arr)];
}

export function parseJsonLd($: CheerioAPI): ParsedJsonLdDocument {
  const state: WalkState = { allTypes: [], identityNodes: [], visitedNodes: 0, truncated: false };

  $('script[type="application/ld+json"]').each((_i, el) => {
    const raw = $(el).text().trim();
    if (!raw) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // 壊れた block は捨て、他の block とページ全体の解析は続行する(契約 §B.5）。
      return;
    }
    walk(parsed, 0, state);
  });

  return {
    allTypes: dedupe(state.allTypes),
    identityNodes: state.identityNodes,
    truncated: state.truncated,
  };
}

/**
 * `website_jsonld_name` / `_address` / `_phone`(scalar signal）の供給元となる
 * **単一の** entity node を選ぶ(契約 §B.2 / §B.4.2）。
 *
 * これらの scalar は既定 claimability が FACT_SAFE であり、営業の場で 1 つの店舗の
 * 事実として読まれる。したがって **異なる entity の値を field 単位で混ぜてはならない**
 * (例: Restaurant の店名 + Organization の本社住所）。
 *
 * Phase 1 は StoreIdentity との照合を行わないため、選択は保守的にする:
 * - strong node がちょうど 1 件 → その node
 * - strong node が複数           → ambiguous として **null**(scalar は未観測扱い）
 * - strong node が 0 件          → **null**。Organization 等の weak node を店舗 fact へ
 *                                   自動昇格させない(weak は identity evidence に留める）
 *
 * いずれの場合も `identityEvidence` には全 node が strength 付きで保持されるため、
 * Phase 3 の identity 判定に使える情報は失われない。
 */
export function selectPrimaryIdentityNode(
  nodes: readonly JsonLdIdentityNode[],
): JsonLdIdentityNode | null {
  const strong = nodes.filter((n) => n.strength === "strong");
  return strong.length === 1 ? strong[0]! : null;
}
