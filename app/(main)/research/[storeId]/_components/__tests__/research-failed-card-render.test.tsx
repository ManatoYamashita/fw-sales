/**
 * `ResearchFailedCard` の描画レベル検証(監査指摘 C)。
 *
 * 純関数テスト(`research-failed-card.test.ts`)は `errorMessage` / `adminDiagnostic` の
 * **戻り値**しか見ないため、admin 限定の診断行が実際に出し分けられているかを固定できない。
 * 本ファイルは `useIsAdmin` の戻り値を差し替えて、3 つの状態を実描画で検証する。
 *
 * 本 repo には jsdom / testing-library を導入していないため、
 * `components/ui/__tests__/yen-amount-input.test.tsx` と同じく `renderToStaticMarkup`
 * (`react-dom/server`)で静的 HTML を得る方式を踏襲する(新規依存なし)。
 *
 * SSR / hydration 前(`loaded === false`)は安全側(非表示)へ倒れることも固定する。
 */

import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StoreResearchRun } from "@/types/research-run";

const { mockUseIsAdmin } = vi.hoisted(() => ({ mockUseIsAdmin: vi.fn() }));

vi.mock("@/components/layout/current-user-provider", () => ({
  useIsAdmin: mockUseIsAdmin,
}));

const { ResearchFailedCard } = await import("../research-failed-card");

/** DB 由来の生メッセージが `error_message` に残っている旧 run を模す。 */
const RAW_ERROR_MESSAGE =
  'Step "stage1Step" failed after 1 retry: key=AIzaSyFAKEKEY123 requestId=8f3c1d2e-aaaa';

const FAILED_RUN: StoreResearchRun = {
  id: "run-1",
  store_id: "store-1",
  requested_by_user_id: null,
  status: "failed",
  stage: "discovering",
  result: null,
  source_registry: [],
  review_decisions: {},
  review_completed_at: null,
  token_usage: null,
  warnings: [],
  error_kind: "retryable_exhausted:rate_limit",
  error_message: RAW_ERROR_MESSAGE,
  started_at: "2026-08-11T00:00:00.000Z",
  expires_at: "2026-08-11T00:30:00.000Z",
  finished_at: "2026-08-11T00:00:40.000Z",
};

function render(): string {
  return renderToStaticMarkup(
    <ResearchFailedCard run={FAILED_RUN} onRetry={() => {}} retrying={false} />,
  );
}

beforeEach(() => {
  mockUseIsAdmin.mockReset();
});

describe("ResearchFailedCard の admin 診断表示(監査指摘 C)", () => {
  it("非adminには診断コードを表示しない", () => {
    mockUseIsAdmin.mockReturnValue({ isAdmin: false, loaded: true });

    const html = render();

    expect(html).not.toContain("診断コード");
    expect(html).not.toContain("retryable_exhausted:rate_limit");
    expect(html).not.toContain("discovering");
    // ユーザー向け文言自体は出ていること(描画そのものが壊れていないことの確認)。
    expect(html).toContain("AI サービスが混雑しているか、利用上限に達しています。");
  });

  it("adminには診断コードとしてerror_kindとstageのみを表示する", () => {
    mockUseIsAdmin.mockReturnValue({ isAdmin: true, loaded: true });

    const html = render();

    expect(html).toContain("診断コード");
    expect(html).toContain("retryable_exhausted:rate_limit");
    expect(html).toContain("discovering");
  });

  it("adminにも生のerror_messageは表示しない(MAJOR12の方針を維持)", () => {
    mockUseIsAdmin.mockReturnValue({ isAdmin: true, loaded: true });

    const html = render();

    expect(html).not.toContain("AIzaSyFAKEKEY123");
    expect(html).not.toContain("8f3c1d2e");
    expect(html).not.toContain("failed after 1 retry");
  });

  it("loaded前(SSR / hydration前)は安全側に倒れ診断コードを表示しない", () => {
    // `useIsAdmin` の context 既定値は `{ isAdmin: false, loaded: false }`。
    // provider の Server Action が解決するまでこの状態になる。
    mockUseIsAdmin.mockReturnValue({ isAdmin: false, loaded: false });
    expect(render()).not.toContain("診断コード");

    // 万一 isAdmin が先に true になっても loaded が false の間は出さないこと
    // (「一瞬 admin 情報が漏れる」経路を作らない)。
    mockUseIsAdmin.mockReturnValue({ isAdmin: true, loaded: false });
    const html = render();
    expect(html).not.toContain("診断コード");
    expect(html).not.toContain("retryable_exhausted:rate_limit");
  });
});
