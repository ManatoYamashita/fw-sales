# フォームコントロール — プルダウン (Select)

- **対象**: 値を 1 つ選ぶプルダウン全般。共通 `Select`（`components/ui/select.tsx`）の API、フォーム連携、使い分けの方針。
- **起点**: #334（全画面のプルダウンをブラウザ標準から共通の独自 UI へ統一）。
- **関連**: [responsive.md](responsive.md)（サイズ・幅の規約、§4.3 の `className` 上書き禁止）、#234 / #225（タッチ領域）、#251（キーボード・読み上げ）。

## 1. 方針

- **アプリ内のプルダウンはすべて共通 `Select` を使う。** ネイティブの `<select>` は書かない。開いた候補がブラウザ / OS 標準のパネル（モバイルではホイールやシート）になり、配色・文字サイズ・タッチ領域を揃えられないため。デスクトップ・モバイルとも独自の候補パネルを出す。
- **値の選択と操作の実行を分ける。** 値を選ぶものは `Select`（`combobox` + `listbox`）。サインアウトや削除など**操作を実行する**メニューは `role="menu"` の操作メニュー（`components/layout/user-menu.tsx`、`stores/[id]/_components/store-detail-tabs.tsx` の「その他のアクション」）で、`Select` に載せない。見た目は同じトークン（`bg-popover` / `border-border` / `shadow-popover` / 角丸 `rounded-md`）で揃えている。
- **選択肢が 2〜4 個で常に見えていてよいもの**（絞り込みのアポ取得・次回アクションなど）はチップ（`ChipGroup`）でよい。プルダウンにするのは、候補が多い・動的に増える・画面幅を取れない場合。

ネイティブの `<select>` が残っていないことは `components/ui/__tests__/native-select-scan.test.ts` が `app/` `components/` `lib/` を構文木で走査して固定する。JSX の `<select>` に加え、`createElement` / `jsx` への静的リテラル・式・テンプレートリテラル・変数参照の 4 形を落とし、コメントや JSDoc の「ネイティブの `<select>`」という説明には反応しない（negative control 付き）。

## 2. API

```tsx
<Select
  width="full"                 // 必須。"full" | "auto"
  density="default"            // "default" | "compact" | "touch"
  options={[{ value: "", label: "未割当" }, ...]}  // 必須。表示順のまま並ぶ
  value={v} onValueChange={setV}                 // 制御モード
  defaultValue="対面" name="meeting_type"          // 非制御 + フォーム送信
  placeholder="不明な担当者"   // 値に一致する候補が無いときの表示
  id / required / disabled / aria-label / aria-labelledby / aria-describedby / aria-invalid
/>
```

| prop | 意味 |
|---|---|
| `options` | `{ value: string; label: string; disabled?: boolean }[]`。enum の値がそのまま表示名なら `optionsFromValues(VALUES)`（`components/ui/select-logic.ts`）で作る。**`select-logic.ts` から import する**（`"use client"` の `select.tsx` から re-export すると Server Component で呼べない） |
| `value` / `onValueChange` | 制御モード。`onValueChange` は**別の候補を選んだときだけ**呼ぶ（同じ候補の選び直しでは呼ばない。ネイティブの `change` と同じ） |
| `defaultValue` | 非制御モードの初期値。省くと先頭の有効な候補（ネイティブの select と同じ） |
| `width` | `full` は親の幅いっぱい。`auto` は**最長の候補ラベルで幅を決め、選び直しで幅が揺れない** |
| `density` | `default`（36px）/ `compact`（32px）は md 未満で 44px のタッチ領域を取る。`touch` は幅によらず常に 44px（狭いコンテナでだけ出る並び替え帯など） |
| `className` | 最小幅・`flex-1` など**配置**のためだけ。高さ・文字サイズ・色・余白は上書きしない（`class-conflicts.test.ts` が落とす。`selectTriggerClasses` が基底クラスの単一の出所） |

値は常に文字列。数値を扱う箇所（エリア検索の半径）は境界で `String()` / `Number()` に変換する。

## 3. フォーム連携

- `name` を渡すと**非表示の入力**で現在値を送る。`<form action>` の FormData・`form` 属性による外部フォームのどちらでも動く。可視のコントロールはトリガーの `button` だけで、非表示の入力は Tab 順にも読み上げにも現れない。
- `required` のときだけ、非表示の入力をブラウザの制約検証に参加できる「視覚的に隠した入力」（`tabindex="-1"` / `aria-hidden`）にする。`type="hidden"` は検証の対象外で必須を伝えられないため。検証エラーでブラウザがその入力へフォーカスしたら、トリガーへ移す。トリガーには `aria-required` を付ける。
- `disabled` はトリガーの `disabled` と、非表示の入力の `disabled`（＝送信しない。ネイティブと同じ）。
- **非制御モードはフォームの `reset` で `defaultValue` へ戻る。** React の `<form action>` が送信成功後に行うリセットも `reset` イベントなので同じ経路で戻る。制御モードは親の state が真実なので、リセットでは変えない。
- **候補にない値は置き換えない。** ネイティブの select は一致する `<option>` が無いと先頭（多くは「未割当」）を表示し、そのまま保存すると利用者が触っていない担当を消していた。`Select` は値をそのまま保持・送信し、トリガーには `placeholder` を出す。担当者の選択では `placeholder="不明な担当者"` を渡す。現在値を候補として明示したい箇所（営業進捗カードの営業担当）は、候補の末尾に `{ value: id, label: "不明な担当者" }` を足す。
- `FormField` は子の `Select` へ `aria-describedby`（hint / error）・`aria-invalid`・`required` を渡す。`<label htmlFor>` はトリガーの `id` と結び付く（`button` は labelable 要素）。

## 4. キー操作とフォーカス

WAI-ARIA の **select-only combobox** パターン。フォーカスは常にトリガーに留まり、強調中の候補は `aria-activedescendant` で伝える。フォーカスが候補パネルへ移らないので、閉じた後に戻す先を覚える必要が無く、モーダルや絞り込みパネルのフォーカストラップとも干渉しない。

| 状態 | キー | 動作 |
|---|---|---|
| 閉 | `Enter` / `Space` / `↓` / `↑` | 開き、選択中の候補（無ければ先頭の有効な候補）を強調 |
| 閉 | `Home` / `End` | 開き、先頭 / 末尾の有効な候補を強調 |
| 閉 | 文字 | 開き、その文字で始まる候補を強調 |
| 開 | `↓` / `↑` / `Home` / `End` / `PageDown` / `PageUp` | 強調を移す（無効な候補は飛ばす。端で回り込まない） |
| 開 | `Enter` / `Space` / `Alt+↑` | 強調中の候補を選んで閉じる |
| 開 | `Esc` | 値を変えずに閉じる。**イベントを止めるので、外側のモーダル・絞り込みパネルは閉じない** |
| 開 | `Tab` | 値を変えずに閉じ、フォーカス移動は既定動作 |
| 開 | 文字 | 前方一致の候補へ移る。500ms 以内の連続入力は 1 語として絞り込み、同じ文字の連打は同じ頭文字の候補を巡る |

- マウス・タッチ: トリガーで開閉、候補で選択、パネル外の `pointerdown` で値を変えずに閉じる。ホバーで強調が移る。
- 選択直後に保存中として `disabled` にする利用側（調査段階・ロール）でも、保存が終わるとフォーカスをトリガーへ戻す（その間に利用者が別の場所へ移っていれば戻さない）。
- `<label>` の中に置いても、候補のクリックがラベルの活性化としてトリガーへ転送されない（候補パネルの `click` の既定動作を止めている）。
- Activity（`cacheComponents`）で画面が隠れたら閉じる。

判定（移動先・文字入力・配置）は `select-logic.ts` の純粋関数で、`select-logic.test.ts` が全分岐を突く。実ブラウザでの開閉・キー操作・送信は `e2e/custom-select.spec.ts`。

## 5. 候補パネルの配置

- **Popover API（`popover="manual"`）の top layer** に載せる。モーダル・`overflow: hidden` のカード・`max-height` のスクロール領域（絞り込みパネル）の中でも切れず、z-index の競合も起きない。DOM 上はトリガーの隣に残るので、外側クリックで閉じる絞り込みパネルの「内側」判定とも矛盾しない。
- 位置は `position: fixed` + JS の計算（CSS anchor positioning は 2026-10 時点で Chrome / Firefox 未対応）。既定はトリガーの直下で左端を揃える。下に収まらず上の方が広いときだけ上へ開く。高さは 320px と開く側の空きの小さい方で、超えた分はパネル内でスクロールする。横は画面端から 8px の余白を保つよう内側へ寄せる。
- スクロール（祖先のスクロール容器を含む）とリサイズで追従し、トリガーが画面外へ出たら閉じる。
- Popover API の無いブラウザでは `fixed` + `z-50` の通常描画に劣化する（Baseline 2025 以降は全対応）。
- 候補の行は md 未満で 44px、md 以上で 32px。選択中はチェックと太字、強調中は `bg-accent`、無効は半透明。

## 6. 既存の依存を使わなかった理由

`package.json` には `@base-ui/react`（cossUI 導入時の依存。`Select` を含む）がある。採らなかったのは次の理由。

- Base UI の `Select` は候補パネルへフォーカスを移す方式で、フォーカスがトリガーに留まらない。このアプリのモーダル（`components/ui/modal.tsx`）と絞り込みパネルは `window` の `keydown` で Esc を受けて閉じるため、パネルへ移ったフォーカスからの Esc が外側まで届く経路を個別に塞ぐ必要がある。
- フォームの `reset` に追従しない（非表示の入力の値だけが戻り、表示が残る）。どのみちラッパーで状態を持つ必要がある。
- body への portal + z-index で重ねる方式で、top layer を使わない。

いずれもラッパーで補えるが、補った結果は「Base UI の上に同じ量の独自処理」になる。判定は純粋関数（`select-logic.ts`）へ切り出せばテストで全分岐を固定できるため、自前にした。将来 Base UI へ寄せる場合も、`Select` の props（`options` / `value` / `defaultValue` / `onValueChange` / `name`）は変えずに中身だけを差し替えられる。

## 7. 新しくプルダウンを足すとき

1. `options` を組み立てる（定数ならモジュール直下、`profiles` 由来ならコンポーネント内）。空値の候補（「未割当」「すべて」「未設定」）は `{ value: "", label }` を先頭に置く。
2. ラベルを結ぶ: `FormField label htmlFor` + `id`、またはラベルが見えない箇所は `aria-label`。
3. フォームで送るなら `name`。即時更新なら `value` + `onValueChange`、保存中は `disabled` にして値を変えさせない。
4. 担当者など動的な候補で、現在値が候補から消えうるなら `placeholder="不明な担当者"`。
5. E2E で選ぶときは `selectOption` ではなく `e2e/support/select.ts` の `chooseOption`（トリガーを押して候補を押す）。開いている間は候補パネルもトリガーと同じ名前を持つので、トリガーは `getByRole("combobox", { name })` で特定する。
