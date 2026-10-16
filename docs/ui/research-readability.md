# 店舗調査詳細の読みやすさ

Issue: [#378](https://github.com/ManatoYamashita/fw-sales/issues/378)

## PLAN

対象は `/research/[storeId]` の店舗ヘッダー、レビューとカテゴリ移動、項目の根拠・出典、完了操作。生成・再調査・判断のサーバー処理は既存のものを使う。

参照: `AGENTS.md`、`CLAUDE.md`、`docs/environment-separation.md`、Next.js 16.3同梱のServer and Client Components / CSSガイド。Next.js / React / Tailwind v4 / Base UIの既存実装に合わせ、新規ライブラリは追加しない。

### デザイン

飲食店への営業準備で、調査値を読み、根拠を確認して採否を判断する調査票として設計する。説明・警告・操作を同じ重さで繰り返さない。

既存の色とフォントを維持する。ライトテーマの基本色は `background #f1f5f9`、`card #ffffff`、`foreground / primary #0f172a`、`muted-foreground #475569`、`border #e2e8f0`、`link #1d4ed8`。ダークテーマは対応する既存セマンティックトークンで切り替える。Inter / Noto Sans JP、店舗名24〜30px、セクション18px、調査値16px、操作・項目名14px、補足12pxの階層とする。

```
店舗名・住所                          店舗情報を見る
AI調査 → レビュー → 営業資産を生成
進捗・カテゴリ           調査結果 / 実施日時 / 信頼性の内訳
  基本情報              カテゴリ名・未判断件数
  立地                    項目名・信頼性
  …                       調査値
                          ▸ 根拠・出典を確認
                          採用 / 編集 / 却下 / スキップ
判断件数・内訳                              次の操作
```

全体を左揃えとする。狭い画面はカテゴリを既存の共通Selectに集約する。カテゴリナビは1280px以上で表示し、本文幅が不足するサイズでは1列に戻す。装飾的な数値カードを並べる案は採用せず、調査項目と未判断件数を起点にする。

## DO

- 最大幅を広げ、カテゴリ移動と進捗を本文の横に配置する。
- 調査値を16pxの主表示とし、根拠・出典をネイティブdetailsへまとめる。重要な注記は折りたたみの外に残す。
- 出典・検索候補タイトルを省略せず折り返す。未確認の候補をリンクにしない既存の信頼性判定を維持する。
- カテゴリ移動は閉じた対象を開いてフォーカスを移す。動きを減らす設定では即時スクロールする。
- フィルタにはaria-pressedと空状態を付ける。固定の完了操作は不透明な背景にし、低い画面では高さ50dvh以内でスクロールする。

## 継続して守るルール

1. 推定・注記あり・登録済み・確認済みの信頼性を、見た目の改善のために同一扱いにしない。
2. 既存情報を上書きする値と推定値は、まとめて採用の対象に増やさない。
3. 情報を省略する場合は全文を開ける導線を設ける。出典の安全性は表示上のタイトルから推測しない。
4. ネストしたdetailsには名前付きgroupを使う。親カテゴリを開いただけで子項目の状態表示を変えない。
5. stickyなカテゴリナビをoverflow-hiddenのCard内に置かない。

## CHECK / ACTION

### レビュー対象と確認範囲

本番のBrasserie NORMANの調査ページを読み取り・スクリーンショットで確認し、実装は最新main（8b262cd）を基点にした。本番にはmainの一部が未反映だったため、mainで既に導入済みの警告集約・安全な一括採用・処理中表示は維持した。

| 領域 | 確認した証拠 | 結果 |
| --- | --- | --- |
| Accessibility | コントロール名・見出し・キーボード開閉、カテゴリ移動後のフォーカス、reduced motion、axe | 下記の移動動作を修正。確認した範囲のHIGH残件なし |
| Layout | 本番スクリーンショット、ローカル1440×1000 / 720×500 / 320×740、フッターと展開した出典 | カテゴリ移動・未判断件数を追加。狭幅のレビュー領域のはみ出し0件 |
| Writing | 既存の採用・編集・却下・スキップ、一括採用の内訳、フィルタと空状態 | 操作名を維持し、カテゴリ選択とフィルタ解除の案内を明記 |
| Typography | 調査値・補足・出典タイトルの実描画と長文ケース | 本文16px、長い出典は折り返し、値の省略を撤去 |
| Colors | 実ブラウザで両テーマの既存トークン5組ずつを測定、axe | 測定した通常文字の組はすべて4.5:1以上 |
| UI | 開閉・ホバー・フォーカス・処理中・採用後、初期ロード | 矢印で開閉を明示。完了操作を不透明な背景に変更 |

### 統合した初期所見（修正済み）

参照行は変更後の対応箇所。Beforeは基点mainの実装と本番画面で観測した内容。

| Severity | Domain | Location | Before | After | Why |
| --- | --- | --- | --- | --- | --- |
| HIGH | Typography | `app/(main)/research/[storeId]/_components/research-source-badge.tsx:115` | 検索候補タイトルに`truncate max-w-[20rem]`。外側のtitle属性にも候補全文はない | 全文を折り返し、長いバッジ文言も折り返す | 出典を判断する情報が省略され、全文に到達できない |
| HIGH | Accessibility | `app/(main)/research/[storeId]/_components/research-review-section.tsx:149` | 項目移動の`behavior: "smooth"`が常時有効 | reduced motionでは`instant` | 動きを減らす設定を尊重していない |
| MEDIUM | Layout | `app/(main)/research/[storeId]/_components/research-review-section.tsx:422` | 全カテゴリが縦一列で、途中から別カテゴリへ移動する導線がない | 進捗・カテゴリナビを横へ置き、狭幅は共通Selectへ切り替える | 確認したい項目を探すための長いスクロールが必要 |
| MEDIUM | Typography | `app/(main)/research/[storeId]/_components/research-item-card.tsx:306` | 調査値・根拠・出典を近い文字サイズと間隔で常時表示 | 値を16pxの主表示、根拠・出典は明示的な開閉 | 読む対象と判断の補足の優先順位が弱い |

### 検証結果

- `pnpm typecheck`: 成功。
- `pnpm lint`: エラー0。開発サーバーのWorkflow自動生成ファイルに既存の未使用eslint-disable警告2件あり。
- `pnpm exec vitest run --maxWorkers=2 --testTimeout=15000`: 202ファイル、4,823件すべて成功。最初の既定並列実行は走査・DBモジュール読み込みの5秒タイムアウトが発生したため、並列数と実行時の待ち時間だけを調整した。テスト設定ファイルは変更していない。
- `/_next/mcp`の`get_compilation_issues`: `issues: []`。`get_errors`: `configErrors: [], sessionErrors: []`。
- `agent-browser ... a11y --selector '#research-review' --json`: 最終版の1440pxライト、1440pxダーク、320pxのキーボード操作後はいずれもviolations 0。狭幅には自動判定不能のcolor-contrast確認1件あり、スクリーンショットと下記の実測で補足。
- ライトテーマの本文/カード17.85:1、補足/カード7.58:1、補足/muted6.92:1、主ボタン17.06:1、注意ラベル6.15:1。ダークは同じ順に13.35:1、5.71:1、6.96:1、16.30:1、8.40:1。
- 320pxで根拠と未確認の情報源を開き、長い候補タイトルを確認。レビュー領域内の描画要素についてviewport外へはみ出す要素0件。720×500でも0件。
- 共通Selectをキーボードで開いて選択し、対象カテゴリが開くこと、対象にフォーカスが移ること、2pxのフォーカス枠が出ることを確認。
- ローカルの架空店舗で採用→Server Action→保存→画面更新を確認。判断済み1件、カテゴリの未判断件数、採用済みバッジが更新された。未判断フィルタで採用済みカードが消えることも確認。
- React DevToolsでAiResearchWorkbench / ResearchReviewSection / ResearchItemCardの実描画と状態を確認。Next.jsの画面更新直後は遷移用の非表示要素が一時的にDOMへ残るため、DOM検証は`checkVisibility()`と実際に見えるコントロールを基準にした。

**Not verified:** 実機VoiceOver・Safari、ブラウザ設定そのものの200%ズーム、生成AIの外部API呼び出し、本番反映。再フローは720pxと320pxで確認した。未調査・実行中・失敗・レビュー完了の状態分岐は既存描画テストで確認し、実ブラウザの操作確認は成功した調査のレビューを対象とした。

**Verdict: Approve**（上記の確認範囲）。HIGHの残件なし。

### 次回の参照事項

共通Selectを使う規約は`components/ui/__tests__/native-select-scan.test.ts`、折り返し時の右寄せは`__tests__/flex-wrap-right-align.test.ts`、特殊ビューのCSS条件は`components/ui/__tests__/responsive-special-views-css.test.ts`が検査する。ページ改善時にも全体のUI走査を実行する。カテゴリナビ・本文・完了操作の順で情報階層を確認する。
