# 色トークン運用ルール

## 役割と載る面を分ける

色トークンは、名前が似ているからという理由で別の役割へ流用しません。特に `*-soft` は背景面、`*-on-soft` はその面上の文字・アイコンとして対にします。

| 役割 | 背景 | 前景 |
| --- | --- | --- |
| 成功 | `bg-success-soft` | `text-success-on-soft` |
| 注意 | `bg-warning-soft` | `text-warning-on-soft` |
| 破壊的状態 | `bg-destructive-soft` | `text-destructive-on-soft` |
| リンク | surface token | `text-link` とそのホバー時トークン |
| 信頼度の動的な薄背景 | `confidenceToBg()` | `text-confidence-foreground` |
| 基本情報の値の信頼度 (3 段階) | `bg-trust-{high,check,low}-soft` | `text-trust-{high,check,low}-on-soft` |

同じセマンティック色でも、載る面が変わればコントラスト比は変わります。新しい組み合わせを追加するときは、light / dark 両テーマで WCAG AA の 4.5:1 以上を確認し、`components/ui/__tests__/color-contrast.test.ts` の宣言的なペアへ追加してください。

## 信頼度の 3 色 (#335)

店舗詳細「店舗の調査情報」の各項目には、値の信頼度を緑「高」・黄「要確認」・赤「低」で出す。

- 判定は `lib/domain/basic-info-trust.ts` の `classifyBasicInfoTrust` だけが持つ。根拠は値の `confidence` (0〜100) だけで、81 以上が緑、50 以上 81 未満が黄、50 未満が赤。区切りは `confidenceTier()` (`lib/url-parser/confidence-color.ts`) に合わせ、medium と low を黄へ集約する。
- 取得区分 (A/B/C) は項目の取りやすさで、値の信頼度ではない。A/B/C を色へ写さない。
- 未入力と、`confidence` を持たない値 (手入力・エリア検索・編集して採用) には色を付けない。未入力を赤にせず、手入力だからと緑にもしない。範囲外・非有限・数値でないスコアは丸めずに「未評価」として扱う。
- 色だけで意味を伝えない。段階ごとに形の違うアイコン (丸のチェック・三角の注意・丸のバツ) と短い文字を併せ、読み上げ名にも「信頼度 高」のように段階を入れる。
- `--trust-*` は信頼度の表示専用。保存・編集などの通常操作や、成功・破壊的操作の表示に流用しない。逆に `warning` は中性化されたグレーなので黄の役割を担えず、`success` / `destructive` は操作の結果や破壊的操作の意味を持つため、信頼度へは流用しない。
- 文字はバッジの soft 面の上に載るため、`trust-*-on-soft` on `trust-*-soft` を light / dark 両方で `color-contrast.test.ts` に登録している (導入時の実測: light 5.51 / 6.38 / 5.91、dark 14.32 / 11.06 / 10.51)。soft 面とカード面の差は小さい (黄の light で 1.07:1) ため、バッジの識別は面の色ではなく文字とアイコンが担う。

## 生パレットの禁止

画面コンポーネントで青系の文字色や緑系の背景色のような、Tailwind 生パレットの色・濃淡番号を直接指定しません。テーマ切替に追従できず、同じ色名でも載る面によってコントラストが壊れるためです。用途に対応するセマンティックトークンが無い場合は、まず `app/globals.css` に役割トークンを追加します。

白色の文字指定も背景が複数のチャート色へ変わる箇所では使用せず、`text-chart-N-foreground` のように背景と対になるトークンを定義します。

## 検証

- 色の実値は `app/globals.css` の light / dark ブロックから取得する。
- CSS utility が実際に生成されることを Tailwind `compile()` で確認する。
- 閾値割れの negative control を残し、検出器自体が空振りしていないことを固定する。
