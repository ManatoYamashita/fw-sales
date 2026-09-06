# 色トークン運用ルール

## 役割と載る面を分ける

色トークンは、名前が似ているからという理由で別の役割へ流用しません。特に `*-soft` は背景面、`*-on-soft` はその面上の文字・アイコンとして対にします。

| 役割 | 背景 | 前景 |
| --- | --- | --- |
| 成功 | `bg-success-soft` | `text-success-on-soft` |
| 注意 | `bg-warning-soft` | `text-warning-on-soft` |
| 破壊的状態 | `bg-destructive-soft` | `text-destructive-on-soft` |
| リンク | surface token | `text-link` / `text-link-hover` |
| 信頼度の動的な薄背景 | `confidenceToBg()` | `text-confidence-foreground` |

同じセマンティック色でも、載る面が変わればコントラスト比は変わります。新しい組み合わせを追加するときは、light / dark 両テーマで WCAG AA の 4.5:1 以上を確認し、`components/ui/__tests__/color-contrast.test.ts` の宣言的なペアへ追加してください。

## 生パレットの禁止

画面コンポーネントで `text-blue-700` や `bg-emerald-50` のような Tailwind 生パレットを直接指定しません。テーマ切替に追従できず、同じ色名でも載る面によってコントラストが壊れるためです。用途に対応するセマンティックトークンが無い場合は、まず `app/globals.css` に役割トークンを追加します。

`text-white` も背景が複数のチャート色へ変わる箇所では使用せず、`text-chart-N-foreground` のように背景と対になるトークンを定義します。

## 検証

- 色の実値は `app/globals.css` の light / dark ブロックから取得する。
- CSS utility が実際に生成されることを Tailwind `compile()` で確認する。
- 閾値割れの negative control を残し、検出器自体が空振りしていないことを固定する。
