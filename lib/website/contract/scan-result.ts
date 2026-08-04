/**
 * WebsiteScanResult(Sales Diagnostics Data Contract v1.2 §B）。
 *
 * Phase 2(network layer / crawl orchestration)が実際にこの型の値を構築する。
 * Phase 1 では型・schema のみを定義し、値を生成する builder は実装しない
 * (crawl orchestration と、PR #199 で追加予定の `safeFetchHtml` に依存するため。
 * どちらも本 PR の時点では存在しない）。
 *
 * 生 HTML を保持するフィールドは持たない(契約 §B.5）。
 */

import { z } from "zod";
import { WebsiteDigitalSignalSchema } from "./signal";
import { WebsiteIdentityStatusSchema, WebsiteIdentityEvidenceSchema } from "./identity";

export const SCAN_STATUSES = [
  "completed",
  "no_candidate_url",
  "candidate_is_portal",
  "redirected_to_portal",
  "robots_disallowed",
  "robots_unavailable",
  "inaccessible",
] as const;
export type ScanStatus = (typeof SCAN_STATUSES)[number];

export const PAGE_OUTCOMES = [
  "extracted",
  "discarded_offsite",
  "discarded_portal",
  "failed",
  "skipped_deadline",
] as const;
export type PageOutcome = (typeof PAGE_OUTCOMES)[number];

export const PageScanRecordSchema = z.object({
  requested_url: z.url(),
  final_url: z.url().nullable(),
  status: z.number().int().nullable(),
  outcome: z.enum(PAGE_OUTCOMES),
});
export type PageScanRecord = z.infer<typeof PageScanRecordSchema>;

export const WebsiteScanResultSchema = z.object({
  scan_status: z.enum(SCAN_STATUSES),
  candidate_url: z.url().nullable(),
  final_url: z.url().nullable(),
  effective_origin: z.string().nullable(),
  origin_redirected: z.boolean(),
  security_blocked: z.boolean(),
  identity_status: WebsiteIdentityStatusSchema,
  identity_evidence: WebsiteIdentityEvidenceSchema,
  signals: z.array(WebsiteDigitalSignalSchema),
  pages_scanned: z.array(PageScanRecordSchema),
  warnings: z.array(z.string()),
  scan_started_at: z.iso.datetime(),
  scan_finished_at: z.iso.datetime(),
  duration_ms: z.number().int().nonnegative(),
});
export type WebsiteScanResult = z.infer<typeof WebsiteScanResultSchema>;
