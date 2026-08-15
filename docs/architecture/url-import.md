# 店舗URL自動入力（URL Import）アーキテクチャ

店舗新規登録画面（`/stores/new`）の「GoogleマップURL」タブで、URL から店舗情報を自動入力する仕組みのリファレンス。

- **対象機能**: **Google マップの店舗ページ URL**（および短縮共有 URL）を貼り付けると、フォームの各フィールドを自動補完する。
- **ユースケース**: 営業担当が Google マップで見つけた店舗を、最小入力で社内 DB に登録するための一次入力支援。

---

## 0. product boundary（Issue #207）

この導線が受け付けるのは **Google マップの店舗 URL のみ**である。

| 入力 | 扱い |
|---|---|
| `…/maps/place/<店名>`（`google.com` / `google.co.jp` / `maps.google.*`） | ✅ 対応 |
| `maps.app.goo.gl/<id>` / `goo.gl/maps/<id>`（短縮共有 URL） | ✅ 対応（redirect 後の URL を**再検証**） |
| 食べログ | ❌ **UI では非対応**。`tabelog_unsupported` として拒否 |
| Instagram | ❌ URL Import では非対応 |
| Google 検索結果 / Google マップの検索・経路 URL / Google トップ | ❌ `not_place_url` として拒否 |
| その他の一般 Web ページ | ❌ `unsupported_source` として拒否 |
| `http://` / 非標準ポート / credentials 付き | ❌ `invalid_url` として拒否（下記） |

### scheme / port の方針

**HTTPS のみ、既定ポートのみ**を受け付ける。

- `http:` は受け付けない。短縮 URL は redirect 解決のため実際に外部 fetch を行うので
  平文への降格を避ける。Google マップは実運用上 https のみで、ブラウザのアドレスバーから
  http URL が得られることはない。唯一の互換性懸念だった `goo.gl` 短縮リンクは
  Google 自身が新規発行を終了しており、救う価値は小さいと判断した。
  古い http リンクを貼った場合は `invalid_url`（「URLの形式を確認してください。」）になる。
- **非標準ポートは拒否する。** `URL.hostname` はポートを含まないため、hostname だけで
  allowlist 判定すると `https://www.google.com:444/maps/place/foo` が通ってしまい、
  短縮 URL 経由で任意ポートへ接続しうる。`URL` は既定ポート（https の 443）を
  正規化して `port === ""` にするため、`https://host:443/…` は通り
  `https://host:444/…` だけが弾かれる。
- `https://user:pass@host/…` も拒否する。

### なぜ Google マップ専用にしたか

本番で確認された 2 つの事故が根拠。

1. **食べログ**: Vercel のデータセンター IP からの取得に対し Cloudflare が
   **HTTP 403 + challenge HTML**（`<title>Just a moment...</title>`）を返す。
   判別変数は送信元 IP のレピュテーションであり、ヘッダ調整では解決しない。
   **Cloudflare の bypass は実装しない**（residential proxy / stealth browser /
   TLS fingerprint 偽装 / 外部 scraping service はいずれも採用しない）。
2. **一般ページ**: 以前は `unknown` な URL でも OGP を取得していたため、
   Google 検索結果ページを貼ると `<title>Google Search</title>` が
   **店舗名として採用されていた**。

### legacy parser の扱い

`lib/url-parser/tabelog.ts` と `lib/url-parser/dictionaries.ts`（食べログの
都道府県・エリア辞書）は**コード上には残っている**が、
`importFromUrlAction` からは到達しない。`parseStoreUrl` 自体は汎用パーサとして
食べログ / Instagram / unknown を返し続けるが、URL Import では
`evaluateUrlImportPolicy` が先に弾く。撤去するかどうかは別 Issue で判断する。

---

## 1. 全体フロー

```
UrlSearchPanel (Client Component)
  └─ importFromUrlAction (Server Action)
       ├─ evaluateUrlImportPolicy : 受け付けてよい URL かの判定（純粋関数）
       ├─ fetchOgp                : 短縮 URL の redirect 解決のみ（server-only）
       ├─ parseStoreUrl           : URL構造の文字列解析（純粋関数）
       ├─ applyParsedData         : フォーム値に整形（純粋関数）
       └─ enrichWithPlacesFallback: Google Places で不足項目を補完
```

| レイヤ | ファイル |
|---|---|
| UI（URL パネル / 手動 / エリア検索） | `app/(main)/stores/new/_components/registration-mode-card.tsx` |
| UI（タブ + 結果表示の親） | `app/(main)/stores/new/_components/store-registration-tabs.tsx` |
| UI（取得結果サマリ） | `app/(main)/stores/new/_components/url-import-summary.tsx` |
| UI（登録フォーム） | `app/(main)/stores/new/_components/store-new-form.tsx` |
| Server Action | `lib/actions/url-parse-actions.ts` |
| **受付 policy** | `lib/url-parser/url-import-policy.ts` |
| ディスパッチャ | `lib/url-parser/index.ts` |
| Google マップ解析 | `lib/url-parser/google-maps.ts` |
| 食べログ解析（legacy、UI から到達しない） | `lib/url-parser/tabelog.ts` |
| OGP / HTML 抽出 | `lib/url-parser/ogp.ts` |
| フィールド合成 | `lib/url-parser/apply.ts` |
| Places 補完 | `lib/url-parser/places-fallback.ts` |
| 都道府県・エリア辞書（legacy） | `lib/url-parser/dictionaries.ts` |
| ジャンル推定 | `lib/url-parser/genre.ts` |
| 型定義 | `lib/url-parser/types.ts` |

---

## 2. UI 層 — `UrlSearchPanel`

クライアントコンポーネント。`useTransition` で非同期処理を扱い、結果を
`onLoaded(payload)` で親（`store-registration-tabs.tsx`）へ渡す。
親が `UrlImportSummary` と `StoreNewForm` を描画する。

タブの表示名は「GoogleマップURL」だが、内部モード値と query parameter は
**`?mode=url` のまま**（既存リンク・ブラウザ履歴との互換のため変更しない）。

主な振る舞い:

- 空 URL は `toast.warn` で弾く。
- `status: "rejected"` は `reason` ごとに文言を出し分ける（下記 §3.1）。
- 店舗名を読み取れなかった場合は**フォームへ進まない**。
  偽の店舗名をフォームへ渡さないため、URL の貼り直しかエリア検索を案内する。
- Places 補完に失敗しても、URL から取得済みの値は**保持したまま**フォームへ進む。

UI には **OGP / HTTP status / Cloudflare / Vercel / sourceType** といった
内部の技術用語を出さない。診断はサーバ側の構造化ログ
（`[safeFetchHtml] failed` / `[fetchOgp] non-2xx` / `[fetchOgp] no name extracted`）が担う。

---

## 3. Server Action — `importFromUrlAction`

`lib/actions/url-parse-actions.ts`

```ts
export async function importFromUrlAction(url: string): Promise<UrlImportResult>

export type UrlImportResult =
  | { status: "success"; parsed: ParsedUrl; ogp: OgpResult | null;
      suggested: ApplyResult; applied: AppliedField[];
      placesFallback?: PlacesFallbackInfo }
  | { status: "rejected"; reason: UrlImportRejectReason };
```

ロジックの要点:

1. **`evaluateUrlImportPolicy(url)` を最初に通す。**
   受け付けない URL に対しては `fetchOgp` も Places API も**一切呼ばない**。
   したがって食べログ URL を送っても Vercel → `tabelog.com` のリクエストは発生しない。
   UI 側のバリデーションだけに頼らない server-side enforcement。
2. `google_maps_short` の場合のみ `fetchOgp` で redirect を解決し、
   **展開後の URL を再び policy へ通す**（§3.2）。
3. `google_maps_place` の場合は **HTTP リクエストを 0 回**にする（§3.3）。
4. `parseGoogleMapsUrl` → `applyParsedData` でフォーム値を生成。
   **`parseStoreUrl` は使わない** — 同関数は `includes("google.com/maps")` 等の部分文字列で
   分類するため `google.co.jp/maps/place/…` を `unknown` に落とす。判定基準の異なる
   2 つの分類を直列に使うと「policy は受理したのにパーサ分類で拒否される」drift が生じる。
   受付可否は policy が唯一の source of truth。
5. `enrichWithPlacesFallback` で不足項目を Places Text Search 1 回で補完。

### 3.1 受付拒否の理由と UI 文言

Server Action は `reason`（機械可読）だけを返し、**文言は持たない**。
文言は Client Component 側の `REJECT_MESSAGE` が持つ。

| `reason` | UI 文言 |
|---|---|
| `tabelog_unsupported` | 食べログURLからの自動入力には対応していません。Googleマップの店舗URLを貼り付けてください。 |
| `unsupported_source` | Googleマップの店舗URLを貼り付けてください。 |
| `not_place_url` | 店舗ページのGoogleマップURLを貼り付けてください。 |
| `invalid_url` | URLの形式を確認してください。 |

### 3.2 短縮 URL の再検証

短縮 URL は貼り付け時点では転送先が分からないため、
`short link → redirect → evil.example` を店舗 URL として採用しないよう、
`final_url` を必ず `evaluateUrlImportPolicy` へ再通過させ、
**`google_maps_place` であること**を要求する（短縮 URL の連鎖は追わない）。

redirect 追跡そのものは `fetchOgp` → `safeFetchHtml` が担い、
**SSRF 防御（DNS pinning / per-hop deadline / body cap / content-type allowlist）は
一切変更していない**。

### 3.3 full place URL で OGP を取得しない理由

- Google マップのページは SPA で、`<title>` は「Google マップ」固定。
  そもそも `apply.ts:pickName` は `google_maps` では **URL 由来の name を優先**しており、
  OGP 由来 name は採用されない。
- `OgpResult.html` の消費者だった `analyzeStoreAction` は既に撤去済みで、
  現在 `html` を読むコードは存在しない（`StoreNewFormInitialImport` からも削除した）。
- したがって取得コスト・レイテンシ・失敗経路を増やすだけの価値しかない。

---

## 4. URL 構造解析 — `parseStoreUrl`

`lib/url-parser/index.ts` がディスパッチャ。**汎用パーサ**であり、文字列 `includes` で
ソース判定する。URL Import からは `evaluateUrlImportPolicy` を通過した
Google マップ URL しか渡らないため、以下の食べログ / Instagram / unknown 行は
**UI からは到達しない**（`parseStoreUrl` を直接呼ぶ他用途のための記載）。

> **注意**: `includes` による判定は trust boundary には使えない。
> 受付可否の判定は必ず `url-import-policy.ts`（`new URL()` の hostname / pathname）で行う。

| 判定キーワード | type | 解析関数 |
|---|---|---|
| `tabelog.com` | `tabelog` | `parseTabelogUrl` |
| `maps.google` / `goo.gl/maps` / `maps.app.goo.gl` / `google.com/maps` | `google_maps` | `parseGoogleMapsUrl` |
| `instagram.com` | `instagram` | URLのみ保持（`instagram_url`） |
| 上記以外 | `unknown` | `raw` のみ保持 |

### 4.1 食べログ — `parseTabelogUrl`（legacy / UI からは到達しない）

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

### 4.3 Instagram（legacy / UI からは到達しない）

URL マッチのみ。`type: "instagram"` と `instagram_url` を返す。OGP 取得対象外。

### 4.4 ジャンル推定 — `guessGenre`

`GENRE_KEYWORDS` 辞書に対する **小文字 includes の線形探索**。最初にヒットしたキーワードのジャンルを返し、無ければ空文字。順序がそのまま優先順位なので、`dictionaries.ts` ではより具体的なキーワードを上に置く前提。

---

## 5. OGP / HTML 抽出 — `fetchOgp`

`lib/url-parser/ogp.ts`（`import "server-only"` でサーバ専用）。

実行条件:

- **短縮共有 URL（`maps.app.goo.gl` / `goo.gl/maps`）の redirect 解決のときだけ呼ばれる。**
  full place URL では呼ばれない（§3.3）。受け付けない URL でも呼ばれない（§3）。
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

## 6.5 Places 補完と wrong-store prevention

`lib/url-parser/places-fallback.ts`

Google マップ URL からは店舗名・`map_url` しか取れないため、
住所 / 電話 / 口コミ評価 / 口コミ件数 / 業態は **Google Places Text Search 1 回**で補完する。

### 採用条件（Issue #207 で厳格化）

**変更前**は「店舗名の完全一致が無ければ `userRatingsTotal` 最多の候補」を採用していた。
これは口コミ件数を identity evidence として使うことに等しく、弱い検索語から
複数候補が返ったときに「その地域で最も有名な**別の店**」を自動登録する経路だった。

現在の `pickBestPlace` は次のとおり。**autofill 率より wrong-store prevention を優先する。**

| 状況 | 結果 |
|---|---|
| 対象店舗名が空 | `null` |
| 正規化後の完全一致が 0 件 | `null` |
| 正規化後の完全一致が 1 件 | その候補を採用 |
| 正規化後の完全一致が 2 件以上 | `null`（ambiguous） |

- 正規化は **表記ゆれの吸収のみ**（`NFKC` / trim / 連続空白の集約 / 英字 case）。
  「本店」「新宿店」等の**支店表記は落とさない**（落とすと別店舗を同一視する）。
- fuzzy match（部分一致・編集距離）も口コミ件数も自動採用条件にしない。

### 補完できなかった理由の区別

`PlacesFallbackInfo.reason` を UI で**同じ文言に潰さない**。とくに
`no_keyword` は **Places を一度も呼んでいない**状態であり、
「Google マップで見つからなかった」と表示するのは事実と異なる。

| `reason` | 意味 |
|---|---|
| `none` | 補完不要（既に高信頼度で揃っている） |
| `no_keyword` | 検索語が無く **Places を呼んでいない** |
| `places_not_found` | 候補 0 件、または名前一致 0 件 |
| `ambiguous` | 同名候補が複数あり一意に絞れない |
| `no_api_key` | `GOOGLE_PLACES_API_KEY` 未設定で呼べなかった |
| `api_error` | Places API の呼び出しが失敗した |

`reason` は `PlacesFallbackReason`（closed union）で、UI の文言テーブルも
`Partial<Record<PlacesFallbackReason, string>>` で型付けしている。
reason を増やしたときに文言の追随漏れを compile time で検出するため。

いずれの失敗でも、**URL から取得済みの値（店舗名 / `map_url` / confidence）は保持**したまま
フォームへ進む。

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

1. **Google マップは SPA レンダリング** — サーバ fetch では OGP がほぼ空のため、実用上 `parseGoogleMapsUrl` の URL 解析結果しか得られない。これが full place URL で OGP を取得しない理由でもある（§3.3）。
2. **`?cid=` / `query_place_id=` 形式は未対応** — 1 店舗を一意に指す公式 URL だが店舗名を読み取れず、現行実装では Places 照合の検索語を作れないため `not_place_url` として拒否している。Place Details 経由での対応は follow-up。
3. **ホスト allowlist は `.com` / `.co.jp` のみ** — 日本国内向けのツールであり、JP アカウント・地域でサインイン中の PC 版 Chrome ではアドレスバーが `www.google.co.jp/maps/…` になるため `.co.jp` を正式対応に含めている。他の ccTLD（`google.de` 等）の Maps URL は受け付けない。`*.google.*` の全許可はしない方針のため、必要になったら `MAPS_HOSTS` へ 1 件ずつ追加する（追加時は `url-parse-actions.test.ts` の end-to-end 回帰ケースにも足すこと。policy だけ広げても、パーサ側の分類とずれると受理されない）。
4. **`guessGenre` は辞書順依存の線形探索** — より具体的なキーワードを辞書の上位に置かないと誤判定する。
5. **legacy: 食べログの正規表現が固定パス前提** — `/A0000/` 系の旧パスや `rstdtl/` 系の詳細パスでは `store_id` を取りこぼす可能性がある（UI からは到達しない）。
6. **legacy: `address_hint` の正規表現が `〒` 必須 / `pickMeta` の属性順序依存** — 食べログ HTML 前提の抽出ルールであり、現在の Google マップ経路では使われない。

---

## 9. 拡張時の指針

- **新しいソース（HotPepper, Retty 等）を追加する場合**:
  1. まず **product boundary（§0）の変更**として合意を取る。現在は Google マップ専用。
  2. `lib/url-parser/{source}.ts` を新設し `parse{Source}Url` を実装。
  3. `index.ts` のディスパッチャに判定を追加。
  4. **`url-import-policy.ts` に受付条件を追加**（`includes` ではなく hostname / pathname 判定）。
  5. 拒否理由を増やす場合は `UrlImportRejectReason` と UI の `REJECT_MESSAGE` を両方更新する。
  6. bot 対策の背後にあるサイトは、**bypass せずに非対応とする**（Issue #207 の方針）。
  4. `ParsedSource` 型（`types.ts`）にリテラルを追加。
- **新しいフィールドを抽出したい場合**:
  1. `OgpResult` または `ParsedUrl` に optional フィールドを追加。
  2. 抽出ロジックを `ogp.ts` または各 parser に追加。
  3. `ApplyResult` に必須フィールドを追加し、`apply.ts` の合成ルールに優先順位を明記。
  4. UI 側（`store-new-form.tsx`）の onApply 受け取りを更新。
- **挙動の優先順位を変えたい場合** — `apply.ts` のみを編集すれば十分。`parsed` / `ogp` の生データは保たれる。
