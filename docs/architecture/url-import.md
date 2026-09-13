# 店舗URL自動入力（URL Import）アーキテクチャ

店舗新規登録画面（`/stores/new`）の「GoogleマップURL」タブで、URL から店舗情報を自動入力する仕組みのリファレンス。

- **対象機能**: **Google マップの店舗ページ URL**（および共有リンク）を貼り付けると、フォームの各フィールドを自動補完する。
- **ユースケース**: 営業担当が Google マップで見つけた店舗を、最小入力で社内 DB に登録するための一次入力支援。

---

## 0. product boundary（Issue #207）

この導線が受け付けるのは **Google マップで 1 店舗を一意特定できる URL のみ**である。

判定軸はドメインではなく **その URL が 1 店舗を曖昧さなく指しているか**。
「Google マップの URL なら何でも受け付ける」ようにはしない。generic な検索 URL を
受け付けて先頭候補を採用すると、**別の店舗を登録する**事故になるためである
（Issue #207 で Places 照合から口コミ件数ベースの自動採用を撤去したのと同じ理由）。

| 入力 | 扱い |
|---|---|
| `…/maps/place/<店名>`（`google.com` / `google.co.jp` / `maps.google.*`） | ✅ 対応（`google_maps_place`） |
| `…/maps/**?query=<店名>&query_place_id=<PLACE_ID>`（公式の Search 形式） | ✅ 対応（`google_maps_place_id`）。Place Details を直接引く |
| `…/maps/**?query_place_id=<PLACE_ID>`（`query` 無し） | ✅ **入力としては**対応。過去に保存された URL の後方互換（下記） |
| `…/maps/**?q=place_id:<PLACE_ID>`（legacy 形式） | ✅ 対応（`google_maps_place_id`） |
| `maps.app.goo.gl/<id>` / `goo.gl/maps/<id>`（短縮共有 URL） | ✅ 対応（redirect 後の URL を**再検証**） |
| `share.google/<id>`（Google の共有リンク） | ❌ `unsupported_source`（下記「share.google を対応しない理由」） |
| 食べログ | ❌ **UI では非対応**。`tabelog_unsupported` として拒否 |
| Instagram | ❌ URL Import では非対応 |
| `…/maps/search/<キーワード>` / `?q=<キーワード>`（Place ID 無し） | ❌ `not_place_url`。検索結果であり 1 店舗を指さない |
| `?cid=<数値>` | ❌ `not_place_url`（下記「CID を対応しない理由」） |
| Google 検索結果 / Google マップの経路 URL / Google トップ | ❌ `not_place_url` として拒否 |
| その他の一般 Web ページ | ❌ `unsupported_source` として拒否 |
| `http://` / 非標準ポート / credentials 付き | ❌ `invalid_url` として拒否（下記） |

### Place ID を明示する URL（`google_maps_place_id`）

`query_place_id` / `q=place_id:` は **店舗名ではなく ID で 1 店舗を確定**できるため、
`/maps/place/<店名>` より強い identity を持つ。両方を満たす URL では Place ID 側を採用する。

- Place ID の読み取りは **`/maps/…` 配下のパスに限定**する。これが無いと
  `https://www.google.com/search?q=place_id:…`（Google **検索**結果）まで通り、
  Issue #207 で塞いだ「`<title>Google Search</title>` を店舗名にする」経路が復活する。
- `place_id:` 接頭辞の**無い** `?q=` は generic search として扱い、絶対に採用しない。
- Place ID は不透明なテキスト識別子として扱い、**文字集合も最大長も仮定しない**。
  Google は Place ID の最大長を規定していない（公式に "there is no maximum length"）。
  独自の上限や文字集合を validity 条件にすると、仕様上正しい ID を将来弾く。
  検証は「空でない」「空白のみでない」「制御文字を含まない」だけに留める。
  解決できない ID は Places API 側が失敗を返し `place_lookup_failed` になる。

  安全性は形式推測ではなく次の層で確保している:
  allowlist 済みホスト / `/maps/…` 配下 / `query_place_id`・`q=place_id:` の明示形式 /
  `URLSearchParams` による取り出し（クエリ全体を ID として採らない） /
  Place Details 組み立て時の `encodeURIComponent`。

### 競合する Place ID は受け付けない

`?query_place_id=A&query_place_id=B` や `?query_place_id=A&q=place_id:B` のように
**異なる identity が併記された URL** を先頭値だけ見て受理すると、ユーザーが意図したのと
別の店舗を登録しうる。`getAll` で全候補を集め、次を満たす場合のみ受理する。

- 候補がすべて valid
- かつ すべて同一 ID

同じ ID の重複は曖昧さが無いので受理する。候補が 1 つも valid でない場合は
「使える identity が無い」だけなので通常判定へ委ねる
（`/maps/place/<店名>?query_place_id=` を壊さないため）。
競合は `/maps/place/<店名>` を満たしていても受け付けない — 名前で照合し直すと
「URL に書かれたどちらの ID でもない店舗」を登録しうるため。

### 入力として受理する形式と、新規生成する形式を分ける

この 2 つは別の話であり、混同しない。

| | 形式 |
|---|---|
| **入力として受理** | `query` の有無を問わず `query_place_id` があれば受理する |
| **新規生成** | 必ず `?api=1&query=<検索語>&query_place_id=<ID>`（公式の Search 形式） |

Google Maps URLs の Search action では **`query` が REQUIRED** であり、
`query_place_id` を使う場合も `query` との併記が必要。したがって
**`query_place_id` 単独の形式を「Google 公式の推奨形式」とは扱わない。**

一方で、本 PR 以前に `stores.map_url` へ保存された `query` 無しの URL が存在しうる。
policy で `query` を必須にすると、それらを貼り直したユーザーが読み込めなくなる。
**「過去形式を読み込める」ことと「今後生成する URL は公式形式にする」ことを分離**し、
policy の受理条件は広いまま、生成側 (`buildPlaceIdMapsUrl`) だけを公式形式に揃えている。

生成は `URLSearchParams` で行い、店舗名に空白・日本語・`&`・`#`・`+` 等が含まれても
query parameter が壊れない。Place ID も内部文字集合を仮定せず同じ経路で encode する。

この形式は **Text Search を経由しない**（§3.4）。

### CID を対応しない理由

`?cid=<数値>` は Places API の `googleMapsUri` が返す形式で 1 店舗を指してはいるが、
**CID は Place ID とは別体系の識別子**であり、現行の Places API 実装に
CID → Place ID の変換経路が無い。「1 店舗を指す」ことと「この実装で一意に解決できる」
ことは別なので、確実に解決できない以上は対応済みにしない。対応するなら follow-up で
変換手段の可否から検討する。

### scheme / port の方針

**HTTPS のみ、既定ポートのみ**を受け付ける。

- `http:` は受け付けない。短縮 URL は redirect 解決のため実際に外部 fetch を行うので
  平文への降格を避ける。Google マップは実運用上 https のみで、ブラウザのアドレスバーから
  http URL が得られることはない。唯一の互換性懸念だった `goo.gl` 短縮リンクは
  Google 自身が新規発行を終了しており、救う価値は小さいと判断した。
  古い http リンクを貼った場合は `invalid_url`（「URLの形式を確認してください。」）になる。
- **この HTTPS-only は redirect hop にも及ぶ。** policy が検査できるのは貼り付けられた
  1 本目の URL だけなので、`fetchOgp` は `safeFetchHtml` へ `allowedSchemes: ["https:"]` を
  渡し、**初回 hop と全 redirect hop**を HTTPS に限定する（§3.2 / §5）。これが無いと
  `https://maps.app.goo.gl/… → 301 → http://evil.example/…` のように途中で平文へ
  降格でき、入力だけ HTTPS-only という不整合になる。
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
       ├─ evaluateUrlImportPolicy : 受け付けてよい URL かの判定 + Place ID 抽出（純粋関数）
       ├─ fetchOgp                : 短縮 URL の redirect 解決のみ（server-only）
       ├─ getPlaceById            : Place ID がある場合のみ。Place Details 1 回（§3.4）
       ├─ parseGoogleMapsUrl      : URL構造の文字列解析（純粋関数）
       ├─ applyParsedData         : フォーム値に整形（純粋関数）
       └─ enrichWithPlacesFallback: Google Places で不足項目を補完（Place ID 経路では呼ばない）
```

パーサは汎用ディスパッチャ `parseStoreUrl` ではなく `parseGoogleMapsUrl` を
**直接**呼ぶ。理由は §3-4（`parseStoreUrl` を挟むと `google.co.jp/maps/place/…` が
`unknown` へ落ち、policy が受理した URL をパーサ側が拒否する drift が起きる）。
`parseStoreUrl` 自体は legacy / 汎用パーサとして残っている。

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
| `short_url_resolve_failed` | Googleマップの共有URLを読み込めませんでした。時間をおいてもう一度お試しください。 |
| `place_lookup_failed` | GoogleマップURLから店舗情報を取得できませんでした。時間をおいて再度お試しいただくか、別の店舗URLをご利用ください。 |

`short_url_resolve_failed` / `place_lookup_failed` は **policy が返す理由ではない**。
型も分かれており、`evaluateUrlImportPolicy` は `UrlImportPolicyRejectReason`（4 種）を返し、
Server Action は実行時失敗を足した `UrlImportRejectReason`（6 種）を返す。

3 つの失敗を混ぜないこと。ユーザーが取るべき行動が異なる。

| reason | 何が起きたか | 次の行動 |
|---|---|---|
| `not_place_url` | URL が 1 店舗を指していない | **別の URL を貼る** |
| `short_url_resolve_failed` | 転送先が分からないまま取得失敗 | 時間をおいて再試行 |
| `place_lookup_failed` | 店舗は確定したが情報を取得できない | 再試行、または別の店舗 URL |

### 3.2 短縮 URL の再検証

短縮共有 URL（`maps.app.goo.gl` / `goo.gl/maps`）は貼り付け時点では
転送先が分からないため、`short link → redirect → evil.example` を店舗 URL として
採用しないよう、展開後の URL を必ず再検証する。

redirect の扱いは次のとおり。

1. `safeFetchHtml` が **`maxRedirects`（既定 5）の範囲内で中間 redirect を追跡**する。
   各 hop で DNS pinning・接続先 IP・credentials・scheme/port 等の SSRF 検証を**毎回**
   やり直す（hop ごとに再検証するのが `safe-http-fetch` の設計）。上限超過は
   `too_many_redirects`。
2. **各 hop は HTTPS に限定される。** 「hop ごとに SSRF 検証する」ことと
   「hop ごとに HTTPS である」ことは**別の保証**である。前者は `safeFetchHtml` の既定で
   得られるが、後者は呼び出し側が `allowedSchemes` を絞らないと得られない
   （`safeFetchHtml` の既定 `DEFAULT_ALLOWED_SCHEMES` は `["http:", "https:"]`）。
   `fetchOgp` は `allowedSchemes: ["https:"]` を渡すため、`http:` への redirect は
   `disallowed_scheme` で拒否され、**その転送先へは DNS 解決も接続も行われない**
   （scheme 判定が `validateExternalUrl` の最初の分岐であるため）。
3. Server Action は最終的な `final_url` を `evaluateUrlImportPolicy` へ再通過させる。
4. 受理するのは **`google_maps_place` または `google_maps_place_id`** のみ。
   `final_url` が共有リンクのままなら拒否する（policy 側の再入ループは行わない）。

> 「redirect を一切追わない」のではない。追跡は `safeFetchHtml` が担い、
> **policy を再帰的に再入しない**という意味である。

展開先が Place ID 形式（`query_place_id` / `q=place_id:`）の場合も、
同じ再検証を通ったうえで §3.4 の経路に入る。**再検証は緩めていない** —
lookalike ドメイン上の Place ID URL へ転送された場合も従来どおり拒否される。

### `share.google` を対応しない理由（実 URL で検証）

Google マップの「共有 → リンクをコピー」が `https://share.google/<id>` を発行する場合が
あるが、**この形式は対応していない**（`unsupported_source`）。

実際に発行された URL を実測した結果、転送先は Google マップではなく
**Google 検索結果ページ**だった。

```
share.google/<id>
  -> 302 www.google.com/share.google?q=<id>
  -> 301 www.google.com/search?...&q=<店舗名>&kgmid=<Knowledge Graph MID>
  -> 200 Google Search
```

最終 URL に `query_place_id` / Place ID / CID / `/maps/place/` は含まれず、得られるのは
**店舗名テキストと Knowledge Graph MID だけ**。店舗名で Text Search へ落とすと同名店舗で
別店舗を引く余地が生まれ、Issue #207 で守った wrong-store prevention の境界を弱めるため
対応しない（Knowledge Graph MID → Place ID の変換経路も現行実装には無い）。

policy 段階で弾くため、この形式では**外部リクエストを 1 回も発生させない**。
UI では代替手順（店舗ページをブラウザで開きアドレスバーの URL を使う）を案内している。

> 「Google の共有リンクすべてに対応」ではない。対応するのは `maps.app.goo.gl` /
> `goo.gl/maps` 形式で、いずれも展開後 URL の再検証を経て初めて店舗と認める。

### 3.3 full place URL で OGP を取得しない理由

- Google マップのページは SPA で、`<title>` は「Google マップ」固定。
  そもそも `apply.ts:pickName` は `google_maps` では **URL 由来の name を優先**しており、
  OGP 由来 name は採用されない。
- `OgpResult.html` の消費者だった `analyzeStoreAction` は既に撤去済みで、
  現在 `html` を読むコードは存在しない（`StoreNewFormInitialImport` からも削除した）。
- したがって取得コスト・レイテンシ・失敗経路を増やすだけの価値しかない。

### 3.4 Place ID がある場合に Text Search を使わない理由

URL が Place ID を含んでいる時点で、店舗は**一意に確定している**。
ここで `enrichWithPlacesFallback`（Text Search）を挟むと、確定済みの identity を
店舗名の文字列照合へ落とすことになり、同名店舗で `ambiguous` になったり
別店舗を引く余地を作る。**確定している identity をわざわざ曖昧にしない。**

```
policy (google_maps_place_id, placeId)
  └─ getPlaceById(placeId)        : Place Details 1 回だけ
       ├─ applyParsedData          : map_url のみ URL 由来
       └─ mergePlaceIntoApply      : name/住所/電話/評価/業態は Places 由来
```

- API 呼び出しは **Place Details 1 回だけ**。Text Search との二重呼び出しはしない。
- 店舗名は **URL から一切読み取らない**。`?q=place_id:…` の文字列や
  `?query=<名前>` を店舗名として採用しない（Places の値を正とする）。
- 失敗時は `place_lookup_failed`（timeout / AbortError も同じ reason へ正規化）。
  Place Details には `URL_IMPORT_PLACE_DETAILS_TIMEOUT_MS`（15 秒）を渡し、
  Places が応答しないときに Server Action が無制限に待たないようにする。

#### ログの責務分担

「UI へ出さない」ことと「サーバログに一切残さない」ことは**別**である。混同しない。

| 層 | 出力先 | 内容 |
|---|---|---|
| Action の戻り値（UI） | クライアント | `reason` のみ。raw message / HTTP status / レスポンス本文は載せない |
| URL Import 層のログ | サーバ | `toPlacesDiagnosticKind` の分類値のみ |
| Places client（`lib/places/google.ts`） | サーバ | 非 2xx 時に **status と redact / clip 済みの body 先頭**を構造化ログへ記録 |

最下層の Places client が診断情報をサーバログへ残すのは**既存の意図的な observability
設計**であり、本 PR では変更していない。API キー等は `redactSecrets` で除去され、
長さは `clipForLog` で制限される。したがって「サーバログにもレスポンス本文を一切出さない」
のではなく、**ユーザーへ到達する経路には出さない**が正しい。
- 結果は `placesFallback: { used: true, reason: "place_id_url", matched_place_id }`
  として報告する（照合の失敗理由ではないので UI の警告文言は持たない）。

### 3.5 `map_url` の round-trip invariant

**success で返す `suggested.map_url` は、`evaluateUrlImportPolicy` で再び受理される。**

`stores.map_url` はユーザーがコピーして URL Import へ貼り直す値なので、
受理できない URL を保存してはいけない。

問題になるのは Places の `googleMapsUri` で、これは
`https://maps.google.com/?cid=<数値>` 形式を返し得る。CID は Place ID とは
別体系で URL Import が受け付けないため、そのまま `map_url` に採用すると
「保存済みの店舗 URL を貼り直すと `not_place_url`」という自己不整合になる。

経路ごとの扱い:

| 経路 | `map_url` |
|---|---|
| Place ID 経路 | 取得した `placeId` / `name` から **公式形式へ正規化**（`buildPlaceIdMapsUrl`）。入力 URL をそのまま保持しない。短縮 URL 経由でも同じ |
| 既存の place URL 経路 | `googleMapsUri` が受理可能ならそれを採用。受理不可（`?cid=…`）なら URL 由来の値へ戻す（`withReimportableMapUrl`） |

Place ID 経路の正規化は、公式仕様の必須項目 `query` を満たしつつ Place ID で一意特定でき、
CID へ戻らず再 import もできる、という条件を同時に満たす。
`source_url` は**ユーザーが実際に貼った URL のまま**保持する（正規化するのは `map_url` だけ）。

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
- fetch 自体は行わず、`lib/security/safe-http-fetch.ts` の `safeFetchHtml` へ委譲する。
  `safeFetchHtml` は `fetch()` ではなく `node:https` / `node:http` の**手動 redirect ループ**で、
  hop ごとに DNS 解決 → IP レンジ判定 → DNS pinning を行う（`AbortController` /
  `cache: "no-store"` は使っていない）。
- `fetchOgp` が渡すオプション:

  | option | 値 | 意味 |
  |---|---|---|
  | `allowedSchemes` | `["https:"]` | 初回 hop と全 redirect hop を HTTPS に限定 |
  | `hopTimeoutMs` | `5000` | 1 hop あたりの idle（無通信）timeout |
  | `totalTimeoutMs` | `8000` | redirect 込み全体の**絶対デッドライン** |
  | `maxBodyBytes` | `2_000_000` | 読み込む本文の上限（2MB） |

  `maxRedirects` と Content-Type allowlist（`text/html` / `application/xhtml+xml`）は
  `safeFetchHtml` の既定に従う。
- `User-Agent` は `safeFetchHtml` 側の既定ヘッダ。外部プロキシ（allorigins 等）は使わず、
  Next サーバから直接接続する。

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

`safeFetchHtml` は失敗時に**定型の `SafeFetchFailureReason` コードだけ**を返す。Node の生
エラー文言（`connect ECONNREFUSED <ip>:<port>` 等、接続先 IP を含みうる）は戻り値に載らない。
`fetchOgp` はその reason を `toSanitizedOgpError`（`SANITIZED_ERROR_MESSAGES` の全件マップ）で
固定の日本語文言へ正規化する。

| `reason` | `OgpResult.error` |
|---|---|
| `invalid_url` | URLの形式が正しくありません |
| `disallowed_scheme` | 対応していないURL形式です |
| `credentials_in_url` | 認証情報を含むURLは使用できません |
| `dns_lookup_failed` / `dns_no_records` | 指定されたURLへ接続できませんでした |
| `dns_timeout` / `timeout` | 接続がタイムアウトしました / タイムアウトしました |
| `disallowed_ip_range` | 安全上アクセスできないURLです |
| `too_many_redirects` | リダイレクトが多すぎるため取得できませんでした |
| `invalid_redirect_location` | リダイレクト先のURLが不正です |
| `body_too_large` | 取得したページのサイズが大きすぎます |
| `disallowed_content_type` | 対応していない形式のページです |
| `http_error` / `network_error` | ページの取得に失敗しました |

非 2xx は失敗ではなく `safeFetchHtml` から `ok: true` で返るため、`fetchOgp` 側で
`{ ok: false, error: "HTTP {status}" }` へ変換する。

**raw error は UI へ出さない。** 診断情報はサーバログのみ、という二系統設計:

| 層 | 出力先 | 内容 |
|---|---|---|
| `safeFetchHtml` の失敗 | サーバログ `[safeFetchHtml] failed` | reason / scheme / host / path（クエリ除去、`clipForLog` で切詰）/ 解決先 IP / hop 番号 / Node の生 message |
| `fetchOgp` の非 2xx | サーバログ `[fetchOgp] non-2xx` | status / `final_url`（クエリ・フラグメント除去）/ Content-Type / 本文先頭 200 文字 |
| `fetchOgp` の name 未抽出 | サーバログ `[fetchOgp] no name extracted`（warn） | 上記 + `blacklistedTitle`。戻り値は `ok: true` のまま |
| Places client (`lib/places/google.ts`) | サーバログ | 非 2xx 時に status と redact / clip 済み bodyHead |
| Action の戻り値 | クライアント | `reason` のみ |

`fetchOgp` は失敗理由の構造化ログを重ねて出さない（`safeFetchHtml` が host / path 付きで
既に 1 行出しているため）。

**URL Import ではこの `error` 文言は UI へ届かない。** `resolveShortUrl`
（`lib/actions/url-parse-actions.ts`）は `fetchOgp` の `{ ok: false }` を理由を問わず
`short_url_resolve_failed` へ正規化し、`ogp.error`（`"タイムアウトしました"` / `"HTTP 500"` 等）
は `reason` へ載せない。sanitize 済みとはいえ HTTP status を UI へ運ぶ必要が無く、文言は
呼び出し側が `reason` から決める設計を崩さないため（§3.1 の reason 表 / §3.2）。

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
2. **`?cid=` 形式は未対応** — 1 店舗を指す公式 URL だが、CID は Place ID とは別体系で、現行の Places API 実装に変換経路が無いため `not_place_url` として拒否している（§0「CID を対応しない理由」）。`query_place_id` / `q=place_id:` は Place Details 経由で**対応済み**（§0 / §3.4）。
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
