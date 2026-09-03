import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { SalesProgressRow } from "@/lib/domain/sales-progress";

/**
 * 狭幅カード (#234 / PR3/3) の内容を固定するテスト。
 *
 * カードは「コンテナ 971px 相当の列集合を縦に積んだもの」と定義しており、
 * 何を載せ何を載せないかは #220 が合意した閾値順にそのまま従う。ここが動くと
 * その定義が崩れるので、決定を明示的にレビューへ乗せる。
 */

// StoreRowActions → store-actions → repos → lib/db の実 DB 接続を遮断する
// (stores-table-empty-state.test.tsx と同規約)。
vi.mock("@/lib/actions/store-actions", () => ({
  bulkDeleteStoresAction: vi.fn(),
  deleteStoreAction: vi.fn(),
  getStoreDeleteImpactAction: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/stores",
  useSearchParams: () => new URLSearchParams(),
}));

const { StoreCard } = await import("../store-card");

const ROW = {
  store: {
    id: "s1",
    name: "さくら屋 渋谷店",
    prefecture: "東京都",
    city: "渋谷区",
    genre: "居酒屋",
    stage: "contacted",
    channel: "DM推奨",
    operator_type: "個人店",
  },
  salesName: "山下",
  urgency: "overdue",
  currentSalesState: "商談中",
  currentNextAction: { date: "2026-09-01", type: "訪問", note: "前回は不在" },
  latestMeetingDate: "2026-08-20",
  appointmentAcquired: false,
  latestDeal: null,
} as unknown as SalesProgressRow;

const render = (row: SalesProgressRow = ROW, canDelete = true) =>
  renderToStaticMarkup(
    <StoreCard row={row} href="/stores/s1?tab=progress" canDelete={canDelete} />,
  );

describe("カードに載せる情報", () => {
  it("店舗名 / 次回アクション / 状態 / 現在の営業状態 / 営業担当 を載せる", () => {
    const html = render();
    expect(html).toContain("さくら屋 渋谷店"); // name (always)
    expect(html).toContain("2026/09/01"); // 次回アクション日 (always)
    expect(html).toContain("訪問"); // 次回アクション種別
    expect(html).toContain("前回は不在"); // メモ
    expect(html).toContain("期限超過"); // urgency バッジ
    expect(html).toContain("山下"); // 営業担当 (971)
    expect(html).toContain("個人店"); // IndividualStoreBadge
  });

  it("最寄駅 / チャネル / 最終営業日 / 業態 は載せない", () => {
    // 閾値 1171 以降の列。詳細画面 (店舗名リンク) へ送る。
    const html = render();
    expect(html).not.toContain("東京都");
    expect(html).not.toContain("渋谷区");
    expect(html).not.toContain("DM推奨");
    expect(html).not.toContain("居酒屋");
    expect(html).not.toContain("2026/08/20");
  });

  it("店舗名を h4 の見出しにする", () => {
    // ページ h2 → Card.Title h3 → 店舗名 h4。スクリーンリーダの見出しジャンプで
    // カード間を移動できるようにする (モバイルの主要ナビゲーション手段)。
    expect(render()).toMatch(/<h4[^>]*>さくら屋 渋谷店<\/h4>/);
  });

  it("詳細へのリンク先が行クリックと同じ (?tab=progress)", () => {
    expect(render()).toContain('href="/stores/s1?tab=progress"');
  });
});

describe("タッチターゲットと横溢れ対策", () => {
  it("見出しリンクが 44px 以上の高さを持つ", () => {
    expect(render()).toContain("min-h-11");
  });

  it("操作ボタンが 44px", () => {
    const html = render();
    expect((html.match(/h-11 w-11/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it("伸縮する flex アイテムが truncate するなら min-w-0 を伴う", () => {
    // flex アイテムの既定 min-width は auto (= コンテンツ由来) なので、flex-1 だけ
    // 付けても縮まず truncate が効かない。375px での横溢れの最頻原因。
    // ブロック要素 (次回アクションのメモ <p> など) は親の幅に従うので対象外。
    const html = render();
    const flexItems = html.match(/<[^>]*\bflex-1\b[^>]*>/g) ?? [];
    expect(flexItems.length).toBeGreaterThan(0);
    for (const tag of flexItems) {
      if (!/\btruncate\b/.test(tag)) continue;
      expect(tag, `flex-1 + truncate なのに min-w-0 が無い: ${tag}`).toContain(
        "min-w-0",
      );
    }
  });

  it("カード直下の横並びは伸縮側と固定側を分けている", () => {
    // 長い店舗名がバッジや操作ボタンを画面外へ押し出さないための構造。
    const html = render();
    expect(html).toContain("min-w-0 flex-1 truncate"); // 見出しの店舗名
    expect(html).toContain("shrink-0"); // バッジ・シェブロン側
  });
});

describe("権限による出し分け", () => {
  it("canDelete=false なら削除ボタンを要素ごと出さない", () => {
    // #155: 破壊的操作は admin 限定。UI 無効化ではなく非描画にする。
    const html = render(ROW, false);
    expect(html).not.toContain("を削除");
    expect(html).toContain("を編集"); // 編集は常に出る
  });

  it("canDelete=true なら削除ボタンを出す", () => {
    expect(render(ROW, true)).toContain("さくら屋 渋谷店 を削除");
  });
});

describe("欠損データ", () => {
  it("次回アクション未設定 / 担当なし / メモなしでも壊れない", () => {
    const sparse = {
      ...ROW,
      salesName: null,
      urgency: "unset",
      currentNextAction: { date: null, type: null, note: null },
    } as unknown as SalesProgressRow;
    const html = render(sparse);
    expect(html).toContain("未設定"); // urgency バッジのフォールバック
    expect(html).toContain("担当: —");
    expect(html).toContain("さくら屋 渋谷店");
  });
});
