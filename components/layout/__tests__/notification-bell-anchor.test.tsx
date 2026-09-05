/**
 * 通知ドロップダウンの包み側が、狭幅でビューポート基準へ移る契約を保っているかを
 * **実際の描画結果**で確かめる (#225 Phase 3)。
 *
 * パネル本体は `open` state でしか描画されないため SSR では見えない。パネル側の
 * クラス契約は `overlay-anchor-classes.test.ts` が定数として押さえ、ここでは
 * **包み側が実際にその定数を身に着けて出ているか**という配線を見る。
 * 包みだけ元へ戻す (= `relative` に直す) と狭幅の破れが復活するので、そこを守る。
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { NotificationBell } from "../notification-bell";
import { OVERLAY_ANCHOR_CONTAINER } from "@/components/ui/overlay-anchor-classes";
import type { Notification } from "@/types/notification";

function render(notifications: Notification[] = []) {
  return renderToStaticMarkup(<NotificationBell notifications={notifications} />);
}

/** 最も外側の div の class 文字列。 */
function outerClasses(html: string): string {
  const m = /^<div class="([^"]*)"/.exec(html);
  const cls = m?.[1];
  expect(cls, "最外の div が見つからない").toBeTypeOf("string");
  return cls!;
}

describe("通知ドロップダウンの位置基準", () => {
  it("包みが共有の位置契約クラスを持つ", () => {
    const cls = outerClasses(render());

    for (const token of OVERLAY_ANCHOR_CONTAINER.split(/\s+/)) {
      expect(cls, `包みに ${token} が無い`).toContain(token);
    }
  });

  it("ベルのボタン自身は relative を保つ (未読バッジの基準)", () => {
    // 包みを static にした副作用でバッジの基準まで移ると、バッジが
    // 画面右上へ飛ぶ。ボタン側の relative がそれを止めている。
    const now = new Date().toISOString();
    const html = render([
      {
        id: "n1",
        user_id: "u1",
        kind: "research_job_completed",
        title: "調査完了",
        body: "AI 店舗調査が完了しました",
        link_url: "/stores/s1",
        read_at: null,
        created_at: now,
        updated_at: now,
      },
    ]);
    const button = /<button[^>]*>/.exec(html)?.[0] ?? "";

    expect(button).toContain("relative");
    // バッジが描画されている前提での検査であることを保証する (未読 0 だと出ない)。
    expect(html).toContain("aria-hidden");
  });

  it("閉じている間はパネルを描画しない", () => {
    expect(render()).not.toContain('aria-label="通知一覧"');
  });
});
