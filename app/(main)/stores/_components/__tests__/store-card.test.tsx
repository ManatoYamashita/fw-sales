import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { SalesProgressRow } from "@/lib/domain/sales-progress";

/**
 * 狭幅のコンパクト行 (#234 で導入、#330 で行表示へ組み直し) の内容を固定するテスト。
 *
 * 行は「コンテナ 998px 相当の列集合を、表の列と同じ順に並べたもの」と定義しており、
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

const { StoreCard, renderNextAction, isResearchStatusImpliedBySalesState } =
  await import("../store-card");

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
  currentSalesState: "following",
  currentNextAction: { date: "2026-09-01", type: "訪問", note: "前回は不在" },
  latestMeetingDate: "2026-08-20",
  appointmentAcquired: false,
  latestDeal: null,
  researchStatus: "架電済み",
} as unknown as SalesProgressRow;

const render = (row: SalesProgressRow = ROW, canDelete = true) =>
  renderToStaticMarkup(
    <StoreCard row={row} href="/stores/s1?tab=progress" canDelete={canDelete} />,
  );

describe("カードに載せる情報", () => {
  it("店舗名 / 次回アクション / 営業状態 / 調査段階 / 営業担当 を載せる", () => {
    const html = render();
    expect(html).toContain("継続追客"); // 営業状態 (778)
    expect(html).toContain("さくら屋 渋谷店"); // name (always)
    expect(html).toContain("2026/09/01"); // 次回アクション日 (always)
    expect(html).toContain("訪問"); // 次回アクション種別
    expect(html).toContain("前回は不在"); // メモ
    expect(html).toContain("期限超過"); // urgency バッジ
    expect(html).toContain("山下"); // 営業担当 (998)
    expect(html).toContain("個人店"); // IndividualStoreBadge
  });

  it("営業状態を調査段階より先に置く (#297 / 表の列優先度と同じ順序)", () => {
    const html = render({ ...ROW, researchStatus: "調査済み" } as SalesProgressRow);
    expect(html).toContain('data-stage="調査済み"');
    expect(html.indexOf("継続追客")).toBeGreaterThan(-1);
    expect(html.indexOf("継続追客")).toBeLessThan(html.indexOf('data-stage="'));
  });

  it("調査段階は store.stage ではなく調査状態を出す (#299)", () => {
    // stage は調査済みでも、未レビューの AI 調査結果があれば一覧・/research と同じくレビュー待ち。
    const html = render({
      ...ROW,
      store: { ...ROW.store, stage: "調査済み" },
      researchStatus: "レビュー待ち",
    } as SalesProgressRow);
    expect(html).toContain("レビュー待ち");
    expect(html).not.toContain('data-stage="調査済み"');
  });

  it("失注のときは再アプローチ可否を添え、失注理由を title に載せる (#297)", () => {
    const lost = {
      ...ROW,
      currentSalesState: "lost",
      latestDeal: { reapproach: "再アプローチ可", lost_reason: "繁忙期で見送り" },
    } as unknown as SalesProgressRow;
    const html = render(lost);
    expect(html).toContain("失注（ロスト）");
    expect(html).toContain("再アプローチ可");
    expect(html).toContain('title="失注理由: 繁忙期で見送り"');
  });

  it("失注で可否が未記録なら「再アプローチ未判断」と出す", () => {
    const lost = {
      ...ROW,
      currentSalesState: "lost",
      latestDeal: { reapproach: null, lost_reason: "" },
    } as unknown as SalesProgressRow;
    const html = render(lost);
    expect(html).toContain("再アプローチ未判断");
    expect(html).not.toContain("失注理由:");
  });

  it("失注以外では再アプローチの行を出さない", () => {
    const won = {
      ...ROW,
      currentSalesState: "won",
      latestDeal: { reapproach: "再アプローチ可", lost_reason: "" },
    } as unknown as SalesProgressRow;
    expect(render(won)).not.toContain("再アプローチ");
  });

  it("最寄駅 / チャネル / 最終営業日 / 業態 は載せない", () => {
    // 閾値 1198 以降の列。詳細画面 (店舗名リンク) へ送る。
    const html = render();
    expect(html).not.toContain("東京都");
    expect(html).not.toContain("渋谷区");
    expect(html).not.toContain("DM推奨");
    expect(html).not.toContain("居酒屋");
    expect(html).not.toContain("2026/08/20");
  });

  it("店舗名を h4 の見出しにする", () => {
    // ページ h1 → Card.Title h3 → 店舗名 h4。スクリーンリーダの見出しジャンプで
    // カード間を移動できるようにする (モバイルの主要ナビゲーション手段)。
    expect(render()).toMatch(/<h4[^>]*>さくら屋 渋谷店<\/h4>/);
  });

  it("詳細へのリンク先が行クリックと同じ (?tab=progress)", () => {
    expect(render()).toContain('href="/stores/s1?tab=progress"');
  });
});

describe("情報の並び (#330: 表の列と同じ順)", () => {
  it("店舗名 → 営業状態 → 次回アクション → メモ → 調査段階 → 営業担当 → 操作 の DOM 順", () => {
    // 見た目の位置 (操作は右上) ではなく DOM 順で読み上げ・タブ順が決まる。
    // 表の行 (店舗名 … 操作) と同じ順で読めることを固定する。
    const html = render();
    const order = [
      "さくら屋 渋谷店",
      "継続追客",
      "期限超過",
      "前回は不在",
      'data-stage="架電済み"',
      "山下",
      "さくら屋 渋谷店 を編集",
    ].map((needle) => html.indexOf(needle));
    expect(order.every((i) => i > -1), JSON.stringify(order)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("操作は DOM の最後に置き、grid の明示配置で 1 行目の右端へ出す", () => {
    const html = render();
    expect(html).toContain("grid-cols-[minmax(0,1fr)_auto]");
    expect(html).toMatch(/<div class="col-start-2 row-start-1">/);
  });

  it("メモは次回アクションの直後に 1 行を占める (basis-full)", () => {
    // 日付の右に並ぶと「電話」のような短いメモが種別と見分けられない。
    expect(render()).toMatch(/<p class="[^"]*\bbasis-full\b[^"]*" title="前回は不在">/);
  });

  it("調査段階と営業担当には見出し語を付ける (表の列見出しの代わり)", () => {
    const html = render();
    expect(html).toContain("調査段階");
    expect(html).toMatch(/担当 (?:<!-- -->)?山下/);
    expect(html).toMatch(/>次回</);
  });
});

describe("枠を持たない (#330)", () => {
  it("行ごとの枠・影・背景を持たない (区切り線は DataTable の li が持つ)", () => {
    const html = render();
    const root = html.match(/^<div class="([^"]*)"/)?.[1] ?? "";
    expect(root).not.toMatch(/\b(?:border|rounded-lg|shadow-xs|bg-card|p-3)\b/);
  });

  it("次回アクションの内側の背景枠を持たない", () => {
    expect(render()).not.toContain("bg-muted/40");
  });

  it("シェブロンを出さない (店舗名が詳細へのリンク)", () => {
    expect(render()).not.toContain("lucide-chevron-right");
  });
});

describe("状態ラベルの重複を省く (#330)", () => {
  it.each([
    ["unresearched", "未調査", true],
    ["researched", "調査済み", true],
    ["initial", "架電済み", false],
    ["following", "架電済み", false],
    ["unresearched", "レビュー待ち", false],
    ["researched", "レビュー待ち", false],
    ["won", "調査済み", false],
  ] as const)("営業状態 %s と調査段階 %s → 省く=%s", (state, status, implied) => {
    expect(isResearchStatusImpliedBySalesState(state, status)).toBe(implied);
  });

  it("「未調査・未営業」の行には調査段階「未調査」を並べない", () => {
    const html = render({
      ...ROW,
      currentSalesState: "unresearched",
      researchStatus: "未調査",
    } as SalesProgressRow);
    expect(html).toContain("未調査・未営業");
    expect(html).not.toContain('data-stage="未調査"');
    expect(html).not.toContain("調査段階");
  });

  it("レビュー待ちは人の作業が残っている合図なので省かない", () => {
    const html = render({
      ...ROW,
      currentSalesState: "researched",
      researchStatus: "レビュー待ち",
    } as SalesProgressRow);
    expect(html).toContain("調査段階");
    expect(html).toContain("レビュー待ち");
  });
});

describe("次回アクションの描画 (表とコンパクト行で共有)", () => {
  const unset = {
    ...ROW,
    urgency: "unset",
    currentNextAction: { date: null, type: null, note: null },
  } as unknown as SalesProgressRow;

  it("表 (stack) は従来どおり日付欄に — を出す", () => {
    const html = renderToStaticMarkup(<>{renderNextAction(unset)}</>);
    expect(html).toContain("未設定");
    expect(html).toContain("—");
  });

  it("コンパクト行 (inline) は日付も種別も無ければ — だけの表示を出さない", () => {
    const html = renderToStaticMarkup(<>{renderNextAction(unset, "inline")}</>);
    expect(html).toContain("未設定");
    expect(html).not.toContain("—");
  });

  it("両方とも同じ緊急度バッジと日付・種別を出す", () => {
    const stack = renderToStaticMarkup(<>{renderNextAction(ROW)}</>);
    const inline = renderToStaticMarkup(<>{renderNextAction(ROW, "inline")}</>);
    for (const html of [stack, inline]) {
      expect(html).toContain("期限超過");
      expect(html).toContain("2026/09/01 / 訪問");
    }
  });
});

describe("タッチターゲットと横溢れ対策", () => {
  it("店舗名のリンクが 44px 以上の高さを持つ", () => {
    expect(render()).toMatch(/<a [^>]*class="[^"]*\bmin-h-11\b[^"]*"/);
  });

  it("操作ボタンが 44px", () => {
    const html = render();
    expect((html.match(/h-11 w-11/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it("truncate する要素はすべて min-w-0 を伴う", () => {
    // 行の中で truncate する要素はどれも flex / grid のアイテムで、既定の
    // min-width: auto (= コンテンツ由来) のままでは縮まず truncate が効かない。
    // 375px での横溢れの最頻原因。
    const html = render();
    const truncating = html.match(/<[^>]*\btruncate\b[^>]*>/g) ?? [];
    expect(truncating.length).toBeGreaterThanOrEqual(4); // 店舗名 / 日付 / メモ / 担当
    for (const tag of truncating) {
      expect(tag, `truncate なのに min-w-0 が無い: ${tag}`).toContain("min-w-0");
    }
  });

  it("店舗名の列は縮み、バッジは縮まない", () => {
    // 長い店舗名がバッジや操作ボタンを画面外へ押し出さないための構造。
    const html = render();
    expect(html).toMatch(/<a [^>]*class="[^"]*\bmin-w-0\b[^"]*"/);
    expect(html).toContain("min-w-0 truncate font-semibold"); // 店舗名
    expect(html).toContain('<span class="shrink-0">'); // 個人店バッジ
  });

  it("切り詰める店舗名・メモ・担当者名は title で全文を読める", () => {
    const html = render();
    expect(html).toContain('title="さくら屋 渋谷店"');
    expect(html).toContain('title="前回は不在"');
    expect(html).toContain('title="山下"');
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
    expect(html).toMatch(/担当 (?:<!-- -->)?—/);
    expect(html).toContain("さくら屋 渋谷店");
  });
});
