# 店舗URL自動入力（URL Import）アーキテクチャ

店舗新規登録画面（`/stores/new`）で URL から店舗情報を自動入力する仕組みのリファレンス。

- **対象機能**: 食べログ / Google マップ / Instagram の店舗 URL を貼り付けると、フォームの各フィールドを自動補完する。
- **ユースケース**: 営業担当が外部サイトで見つけた店舗を、最小入力で社内 DB に登録するための一次入力支援。

---

## 1. 全体フロー

呼び出しは UI →サーバアクション→3つの純粋関数、という直線的な構成。

```
UrlImportPanel (Client Component)
  └─ importFromUrlAction (Server Action)
       ├─ parseStoreUrl    : URL構造の文字列解析（純粋関数）
       ├─ fetchOgp         : 対象サイトのHTML直fetch（server-only）
       └─ applyParsedData  : 上記2つをマージしてフォーム値に整形
```

| レイヤ | ファイル |
|---|---|
| UI | `app/(main)/stores/new/_components/url-import-panel.tsx` |
| Server Action | `lib/actions/url-parse-actions.ts` |
| ディスパッチャ | `lib/url-parser/index.ts` |
| 食べログ解析 | `lib/url-parser/tabelog.ts` |
| Google マップ解析 | `lib/url-parser/google-maps.ts` |
| OGP / HTML 抽出 | `lib/url-parser/ogp.ts` |
| フィールド合成 | `lib/url-parser/apply.ts` |
| 都道府県・エリア辞書 | `lib/url-parser/dictionaries.ts` |
| ジャンル推定 | `lib/url-parser/genre.ts` |
| 型定義 | `lib/url-parser/types.ts` |

---

## 2. UI 層 — `UrlImportPanel`

クライアントコンポーネント。`useTransition` で非同期処理を扱い、結果を親フォームの `onApply(suggested)` に渡す。

主な振る舞い:

- 空 URL は `toast.warn` で弾く。
- `parsed === null` の場合は「認識できる形式の URL ではありません」を表示。
- 成功時は `result.suggested.name` を含むトースト＋直近結果バッジ（`type` / 「詳細取得済み」 or 「URL解析のみ」 / OGP エラー）を描画。

`onApply` で受け取った `ApplyResult` をフォームへ流し込むのは親（`store-new-form.tsx`）側の責務。

---

## 3. Server Action — `importFromUrlAction`

`lib/actions/url-parse-actions.ts`

```ts
export async function importFromUrlAction(
  url: string,
  options: { fetchOgp?: boolean } = { fetchOgp: true },
): Promise<UrlImportResult>
```

戻り値:

```ts
interface UrlImportResult {
  parsed: ParsedUrl | null;
  ogp: OgpResult | null;
  suggested: ApplyResult;
}
```

ロジックの要点:

1. `parseStoreUrl(url)` で URL 構造を解析。
2. `parsed.type === "tabelog" | "google_maps"` のときだけ OGP を取りに行く（Instagram と unknown は HTML fetch しない）。
3. `applyParsedData(parsed, ogp)` で最終フォーム値（`ApplyResult`）を生成。

---

## 4. URL 構造解析 — `parseStoreUrl`

`lib/url-parser/index.ts` がディスパッチャ。文字列 `includes` でソース判定する。

| 判定キーワード | type | 解析関数 |
|---|---|---|
| `tabelog.com` | `tabelog` | `parseTabelogUrl` |
| `maps.google` / `goo.gl/maps` / `maps.app.goo.gl` / `google.com/maps` | `google_maps` | `parseGoogleMapsUrl` |
| `instagram.com` | `instagram` | URLのみ保持（`instagram_url`） |
| 上記以外 | `unknown` | `raw` のみ保持 |

### 4.1 食べログ — `parseTabelogUrl`

正規表現 `tabelog\.com\/([^/]+)\/([^/]+)\/([^/]+)\/(\d+)` で 4 セグメントを抽出し、`dictionaries.ts` の3つの辞書で日本語化する。

| セグメント | 例 | 変換先 | confidence |
|---|---|---|---|
| `pref` | `tokyo` | `prefecture` = 「東京都」 | `high` |
| `area` | `A1301` | `city`（エリア概念のヒント） | `medium` |
| `subarea` | `A130101` | `station_area`（駅周辺） | `high` |
| `storeId` | 数字列 | `store_id`（識別子） | — |

辞書ヒットしないキーは `*_raw` のみが入り、最終フォームには反映されない。

### 4.2 Google マップ — `parseGoogleMapsUrl`

優先順位:

1. `/maps/place/{店名}` を `decodeURIComponent` し `+` を空白へ → `name`（confidence: `medium`）
2. 上記が無ければ `?q={...}` から `name`（confidence: `low`）
3. 取れた店名を `guessGenre()` に通してジャンル推定（confidence: `medium`）

`data=...` で始まる文字列は店名扱いから除外する。

### 4.3 Instagram

URL マッチのみ。`type: "instagram"` と `instagram_url` を返す。OGP 取得対象外。

### 4.4 ジャンル推定 — `guessGenre`

`GENRE_KEYWORDS` 辞書に対する **小文字 includes の線形探索**。最初にヒットしたキーワードのジャンルを返し、無ければ空文字。順序がそのまま優先順位なので、`dictionaries.ts` ではより具体的なキーワードを上に置く前提。

---

## 5. OGP / HTML 抽出 — `fetchOgp`

`lib/url-parser/ogp.ts`（`import "server-only"` でサーバ専用）。

実行条件:

- ソースが `tabelog` または `google_maps` のときのみ呼ばれる。
- `User-Agent` を独自に偽装、`AbortController` で 8 秒タイムアウト、`cache: "no-store"` で常に最新を取得。
- 外部プロキシ（allorigins 等）は使わず、Next サーバから直 fetch。

抽出ルール（正規表現ベース）:

| 抽出元 | フィールド | 補足 |
|---|---|---|
| `<title>` | `name` | 末尾の「\| 食べログ…」「\| Google…」を除去し、`-` または `－` で分割した先頭を採用 |
| `og:title` | `name`（`<title>` で取れなければ） | 同様にサフィックス除去 |
| `og:description` | `description`（200文字に切詰）+ `genre` 補完 | |
| `(\d+\.\d+)\s*点` | `rating` | 食べログの星評価（数値） |
| `口コミ.{0,8}(\d+)\s*件` | `review_count` | 食べログの口コミ件数 |
| `〒\d{3}-\d{4}\s*…(都\|道\|府\|県)…` | `address_hint` | 郵便番号必須 |
| `0\d{1,4}-\d{1,4}-\d{4}` | `phone` | ハイフンは半角・全角両対応 |

エラーハンドリング:

- HTTP 非 2xx → `{ ok: false, error: "HTTP {code}" }`
- AbortError → `{ ok: false, error: "タイムアウトしました" }`
- その他例外 → `{ ok: false, error: e.message }`

UI ではこの `error` がバッジ右側に表示される。

---

## 6. フィールド合成 — `applyParsedData`

`lib/url-parser/apply.ts`。**ここが最終的なフィールド決定権を持つ**。挙動を変えたいときは原則ここだけを編集する。

合成順序:

1. `ApplyResult` を全フィールド空（数値は `null`）で初期化。
2. **`parsed` 由来の値で埋める**:
   - `prefecture` / `city` / `name` / `genre` / `map_url` / `instagram_url`
   - `station_area` がある場合 → `address` に「{駅}周辺」
   - `tabelog_url` がある場合 → `memo` に「食べログURL: {url}」
3. **`ogp.ok` の場合に上書き**:
   - `name` / `phone` / `rating`（→`review_avg`）/ `review_count` は **OGP 後勝ち**。
   - `genre` は `parsed` で未設定の場合のみ補完（`!fields.genre` ガード）。
   - `prefecture` が空のときのみ `address_hint` から `/(東京都|大阪府|京都府|北海道|.+?[都道府県])/` で抽出。
   - `parsed.type === "tabelog"` の場合に限り、`og:description` の冒頭100文字を `memo` に追記。

優先順位の覚え方:

- **後から取った OGP の方が信頼できる**（実HTMLを実際に取得しているため）。
- ただし **辞書で確定した地理情報（prefecture/city/station_area）は上書きしない**。
- ジャンルは「URL から確実に分かったもの > OGP 推測」。

---

## 7. 型契約

`lib/url-parser/types.ts`

- `ParsedUrl` — URL 解析結果。`confidence` で各フィールドの信頼度（`high`/`medium`/`low`）を保持。
- `OgpResult` — HTML 抽出結果。`ok: false` の場合は `error` のみ意味を持つ。
- `ApplyResult` — フォームに直接流し込める最終形。**全フィールド必須**（空文字 or `null` で初期化される）。

`ApplyResult` を変えると UI 側の受け取りも合わせる必要があるので、フィールド追加時は `apply.ts` と `store-new-form.tsx` の両方を更新する。

---

## 8. 既知の制約・改修候補

実装上の弱点として認識しておくべき項目。

1. **食べログの正規表現が固定パス前提** — `/A0000/` 系の旧パスや `rstdtl/` 系の詳細パスでは `store_id` を取りこぼす可能性がある。
2. **Google マップは SPA レンダリング** — サーバ fetch では OGP がほぼ空のため、実用上 `parseGoogleMapsUrl` の URL 解析結果しか得られない。
3. **`address_hint` の正規表現が `〒` 必須** — 郵便番号を含まない住所表記は拾えない。
4. **`ApplyResult.site_url` が常に空** — 食べログ URL は `memo` に文字列として埋め込まれるのみで、`site_url` フィールドには反映されない。仕様か不具合か要確認。
5. **Instagram は URL 保存のみ** — OGP fetch 対象外なので店名等は埋まらない。
6. **`pickMeta` の正規表現が属性順序依存** — `<meta property="..." content="...">` と `<meta content="..." property="...">` の両順に対応はしているが、属性間に余計な属性が入るケースには弱い。
7. **`guessGenre` は辞書順依存の線形探索** — より具体的なキーワードを辞書の上位に置かないと誤判定する。

---

## 9. 拡張時の指針

- **新しいソース（HotPepper, Retty 等）を追加する場合**:
  1. `lib/url-parser/{source}.ts` を新設し `parse{Source}Url` を実装。
  2. `index.ts` のディスパッチャに `includes` 判定を追加。
  3. OGP も対象にしたければ `url-parse-actions.ts` の `parsed.type` ガードに型を追加。
  4. `ParsedSource` 型（`types.ts`）にリテラルを追加。
- **新しいフィールドを抽出したい場合**:
  1. `OgpResult` または `ParsedUrl` に optional フィールドを追加。
  2. 抽出ロジックを `ogp.ts` または各 parser に追加。
  3. `ApplyResult` に必須フィールドを追加し、`apply.ts` の合成ルールに優先順位を明記。
  4. UI 側（`store-new-form.tsx`）の onApply 受け取りを更新。
- **挙動の優先順位を変えたい場合** — `apply.ts` のみを編集すれば十分。`parsed` / `ogp` の生データは保たれる。
