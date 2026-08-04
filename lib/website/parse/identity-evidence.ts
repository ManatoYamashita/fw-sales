/**
 * Identity evidence の抽出(Plan v1.1 §8、契約 §B.4.2）。
 *
 * このファイルは evidence の**抽出**のみを行う。match 判定(target_match 等)は
 * Phase 3 の責務であり、ここには含めない。
 *
 * 重複除去の正規化(`normalizeForDedup`）は、このファイル内での「ほぼ同じ値の重複」を
 * 畳み込むためだけの簡易処理であり、Phase 3 の実際の identity matching
 * (`lib/domain/identity-match.ts` 予定、#180 merge 後に整理)とは別物である。
 * 混同しないこと。
 */

import type { JsonLdIdentityNode } from "./json-ld";
import type { IdentityCandidate, WebsiteIdentityEvidence } from "../contract/identity";

/** 重複除去専用の軽量正規化。全角/半角統一・空白除去・大文字小文字統一のみ行う。 */
export function normalizeForDedup(s: string): string {
  return s.normalize("NFKC").replace(/\s+/g, "").toLowerCase();
}

/**
 * 同一正規化値が複数 provenance で観測された場合、strength の強い方を残す。
 * 同じ strength であれば先に現れたものを残す(決定的）。
 */
export function dedupeCandidates(candidates: readonly IdentityCandidate[]): IdentityCandidate[] {
  const byKey = new Map<string, IdentityCandidate>();
  for (const c of candidates) {
    const key = normalizeForDedup(c.value);
    if (key === "") continue;
    const existing = byKey.get(key);
    if (!existing || (existing.strength === "weak" && c.strength === "strong")) {
      byKey.set(key, c);
    }
  }
  return [...byKey.values()];
}

export interface BuildIdentityEvidenceInput {
  identityNodes: readonly JsonLdIdentityNode[];
  h1: string | null;
  title: string | null;
  phoneLinks: readonly string[];
  sourceUrl: string;
}

/**
 * 1 ページ分の identity evidence を構築する。
 * - JSON-LD の strong/weak node の name/address/telephone
 * - h1 / title(name のみ、常に weak）
 * - tel: link(phone のみ、常に weak）
 */
export function buildIdentityEvidence(input: BuildIdentityEvidenceInput): WebsiteIdentityEvidence {
  const names: IdentityCandidate[] = [];
  const addresses: IdentityCandidate[] = [];
  const phones: IdentityCandidate[] = [];

  for (const node of input.identityNodes) {
    const provenance = node.strength === "strong" ? "json_ld_strong_entity" : "json_ld_organization";
    if (node.name) {
      names.push({ value: node.name, strength: node.strength, source_url: input.sourceUrl, provenance });
    }
    if (node.address) {
      // Organization の address は weak(node.strength がそのまま weak になる、契約 §B.4.2）。
      addresses.push({ value: node.address, strength: node.strength, source_url: input.sourceUrl, provenance });
    }
    if (node.telephone) {
      // Organization の telephone も weak(単独では target_match の strong evidence にしない）。
      phones.push({ value: node.telephone, strength: node.strength, source_url: input.sourceUrl, provenance });
    }
  }

  if (input.h1) {
    names.push({ value: input.h1, strength: "weak", source_url: input.sourceUrl, provenance: "h1" });
  }
  if (input.title) {
    names.push({ value: input.title, strength: "weak", source_url: input.sourceUrl, provenance: "title" });
  }
  for (const p of input.phoneLinks) {
    phones.push({ value: p, strength: "weak", source_url: input.sourceUrl, provenance: "tel_link" });
  }

  return {
    names: dedupeCandidates(names),
    addresses: dedupeCandidates(addresses),
    phones: dedupeCandidates(phones),
  };
}
