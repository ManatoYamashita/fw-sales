# Sales Diagnostics Data Contract v1.2

## 0. この document の位置づけ

**本 document は Sales Diagnostics 全体の normative specification である。**
Zod schema / TypeScript の定数・型 / test は、この document が規定する意味論を
**実装し検証するもの**であり、コード単独を Source of Truth にしない。

- 契約を改訂する場合は、**本 document を先に改訂**し、対応する schema / 定数 / test を
  追随させる(逆方向 — コードを先に変えて document を後追いさせる — を禁ずる)。
- 各 Zod schema・定数には、対応する本 document の節番号を JSDoc に明記し、
  drift をコードレビューで検出可能にする。
- 本 document は 2 部構成である:
  - **Part A** — Sales Diagnostics 全体に適用される global な契約
  - **Part B** — Website Scanner V1 が実装する signal 群の **subset** 仕様

**Part A / Part B の区別はコード上でも構造化されている。**
Part A の global union は `lib/website/contract/global-signal.ts`
(`GLOBAL_SIGNAL_STATUSES` 5 値 / `GLOBAL_CLAIMABILITIES` 4 値 / `SignalValueSchema` 8 型 /
`STORAGE_POLICIES` 4 値 / `GlobalDigitalSignalSchema`）に定義され、Part B の subset は
`lib/website/contract/signal.ts` に `Website` 接頭辞付きで定義される
(`WEBSITE_SIGNAL_STATUSES` 3 値 / `WEBSITE_CLAIMABILITIES` 3 値 /
`WebsiteDigitalSignalSchema`）。global に見える無印の名前を subset に割り当てない
(そうすると将来 `absent_confirmed` を生成する collector が現れた際に drift を招く）。

> 配置に関する注記: 現時点で collector は Website Scanner のみのため、global 定義も
> 便宜上 `lib/website/contract/` 配下に置いている。2 つ目の collector を追加する時点で
> collector 非依存の場所へ移動すること(§C）。

**Part A と Part B を混同しないこと。** Website Scanner V1 が特定の値
(例: `QUESTION_ONLY` / `absent_confirmed` / `not_applicable`)を生成しないことは、
それらの値が Sales Diagnostics 全体の契約から削除されることを意味しない。
Website Scanner はこの契約が定義する多数の collector のうち **1 つ**であり、
deterministic extraction のみを行う collector としての制約により、契約が許容する
値の一部だけを使用する。

---

## Part A — Sales Diagnostics Global Contract(normative）

### A.1 目的と営業ロジック

Sales Diagnostics の目的は「この店舗について今、安全に何を営業で話せるか」を
構築することである。営業ロジックは次の 5 段階から成る:

```
Fact → Gap → Hypothesis → Question → Offer
```

- **Fact**: 観測に基づき確定した事実。collector(Website Scanner 等)が生成する。
- **Gap**: 期待される Fact が観測されなかったことによる欠落。
- **Hypothesis**: Gap から導かれる推測。
- **Question**: Hypothesis を確認するために営業が発する質問。
- **Offer**: Question への回答を踏まえた提案。

**collector(本 document の Part B が定義する Website Scanner を含む)は Fact 層のみを
生成する。** Gap / Hypothesis / Question / Offer の生成は collector の責務ではなく、
別レイヤ(Opportunity Engine、本 document のスコープ外)が担う。

### A.2 SignalValue

すべての観測値は、以下の discriminated union のいずれか 1 つとして表現される
(値を持たない `none` を含む):

```ts
type SignalValue =
  | { type: "boolean";     value: boolean }
  | { type: "string";      value: string }
  | { type: "number";      value: number }
  | { type: "url";         value: string }   // 検証済み URL 文字列
  | { type: "date";        value: string }   // ISO 8601 date
  | { type: "string_list"; value: string[] }
  | { type: "url_list";    value: string[] }
  | { type: "none" };                        // 値を持たない
```

### A.3 DigitalSignal

1 つの観測結果は次の形状を持つ:

```ts
interface DigitalSignal {
  key: string;                    // signal の識別子
  value: SignalValue;
  status: SignalStatus;           // A.4
  identity: IdentityStatus;       // A.6(collector 固有の trust boundary パターンの具体化)
  claimability: Claimability;     // A.5
  provenance: string;             // A.7。どの collector / stage が生成したか
  source_urls: string[];          // 観測元。実際に観測したものだけを含む
  observed_at: string;            // ISO 8601 datetime
}
```

**不変条件:** `status === "observed"` **であるとき、かつそのときのみ**
`value.type !== "none"`。「値はあるが未観測」という中間状態は存在しない。

### A.4 status semantics(global）

| status | 意味 |
|---|---|
| `observed` | 観測に成功し、値が確定している |
| `not_observed` | 観測できなかった。**「存在しない」を意味しない**(A.9) |
| `inaccessible` | 観測を試みたが、到達不能・取得失敗・ブロック等で結果を得られなかった |
| `not_applicable` | この signal が、観測済みの他の値に対して**構造的に無意味**である(従属関係。観測できなかったことの言い換えとして使ってはならない) |
| `absent_confirmed` | **網羅的な確認手段により、存在しないことを確定できた** |

**この 5 値すべてが global contract の一部である。** ある collector がそのうちの
一部しか生成しない場合でも、union から値を削除しない(A.9 参照)。

### A.5 Claimability

観測値を営業の場でどう扱ってよいかを表す 4 値。ランクは以下の順(弱い→強い):

```
DO_NOT_USE  <  INTERNAL_ONLY  <  QUESTION_ONLY  <  FACT_SAFE
```

| claimability | 意味 |
|---|---|
| `FACT_SAFE` | 営業の場で確定した事実として述べてよい |
| `QUESTION_ONLY` | 事実として確定はしていないが、Hypothesis → Question 段階を経て**質問の形**で使える根拠がある。**collector 自身はこの値を直接生成しない**(A.5.1 参照) |
| `INTERNAL_ONLY` | 内部診断・優先度付けにのみ使用可。営業の場では事実としても質問としても一切出してはならない |
| `DO_NOT_USE` | 営業出力に一切影響させてはならない(identity 不一致・アクセス遮断等) |

複数の要因(signal 定義の既定値・status・identity 等)から最終 claimability を導く場合、
**最も弱い(rank が最小の)値**を採用する("weakest wins" 合成)。

#### A.5.1 QUESTION_ONLY と collector の関係

`QUESTION_ONLY` は **Gap → Hypothesis → Question 段階(Opportunity Engine、本 document
のスコープ外)が Question オブジェクトに付与する claimability**であり、Fact 層の
collector(Website Scanner を含む)が自らの DigitalSignal に直接付与するものではない。
collector は deterministic extraction のみを行い、Gap/Hypothesis 推論を行わないため、
`QUESTION_ONLY` を生成する根拠を持たない。

**このことは `QUESTION_ONLY` を Claimability union から取り除く理由にはならない。**
将来、他の collector や Opportunity Engine がこの値を利用する。

### A.6 Identity status(trust boundary パターン)

「観測に成功したこと」と「その観測対象が診断対象の entity であると確認されたこと」を
分離するための trust boundary パターン。global には次の一般形を持つ:

```
candidate_known_url   -- 初期状態。まだ照合していない。trusted ではない
trusted_manual        -- 人間の明示的操作によってのみ到達する
target_match          -- collector 自身の deterministic な照合により確認済み
uncertain             -- 照合を試みたが確信を持てなかった
unrelated             -- 明確に対象外と判定された
```

この 5 値のパターンは Website Scanner 固有ではなく、URL/外部ソースに基づいて
observed data を収集するあらゆる collector が採用しうる汎用パターンである。
Part B はこのパターンを Website Scanner 用に具体化したものである。

**`trusted_manual` は、どの collector においても、人間による明示的な操作
(例: 営業担当者が「このURLは公式で間違いない」と確認する UI 操作)を経由してのみ
到達する。collector が自動判定で `trusted_manual` を生成することはない。**

**`candidate_known_url` は trusted ではない。** 「システムが知っている URL である」
ことは「その URL が対象 entity のものだと確認された」ことを意味しない。

**`target_match` のみが FACT_SAFE 候補になる。** 正確には、`target_match` または
`trusted_manual` の状態にある observed signal のみが、他の要因(status 等)と
合成した上で FACT_SAFE に到達できる。

### A.7 Provenance

`DigitalSignal.provenance` は、その signal を生成した collector / stage を識別する
文字列である。監査・契約 drift 検出のため、どの signal がどの subsystem の責任範囲か
を追跡可能にする。Website Scanner V1 は `"website_scanner_v1"` を用いる(Part B.2)。

### A.8 Storage policy

signal の**定義**(instance ではなく型)は、次の 4 値のいずれかの storage policy を持つ:

| storage policy | 意味 |
|---|---|
| `persist_allowed` | 永続化(snapshot 保存)が許可されている。実際に永続化するかは実装フェーズの判断 |
| `read_through_only` | 常に source から新しく取得しなければならない。キャッシュ・永続化を禁止する(鮮度が誤情報になりうる、または第三者コンテンツの複製を避ける) |
| `derived_existing_only` | 既に永続化された他データから読み取り時に計算される。それ自身の独立した保存領域を持たない |
| `prohibited` | いかなる事情でも永続化してはならない |

**storage policy は「今実装が永続化するか」とは独立した、データガバナンス上の宣言である。**
`persist_allowed` は「永続化してよい」という許可であり、「永続化されている」ことを
意味しない。Website Scanner V1 は全 16 signal を `persist_allowed` と宣言するが、
V1 の実装(Phase 1〜4)は実際には永続化を行わない(Part B.5、Phase 5 参照)。

### A.9 Absence semantics

**`not_observed` ≠ 存在しない。** 観測できなかったことは、対象が存在しないことの
証明にはならない。「存在しないと確定した」と主張するには、`absent_confirmed`
という別の status を用いる必要があり、これは**網羅的な確認手段**を要求する
(例: サイト全体の sitemap を完全に走査した上で該当ページが無いと確認する等)。

Website Scanner V1 は限定的な crawl(homepage + 最大 4 subpage)しか行わず、
網羅性を担保できないため、**`absent_confirmed` を生成しない**(Part B.5)。
これは V1 の実装上の制約であり、`absent_confirmed` という status 自体を
global union から削除する理由にはならない。将来、より網羅的な収集手段
(例: sitemap.xml 全走査)を持つ collector がこの status を利用できる。

### A.10 Persistence boundary

Signal の**永続化可否**(A.8 の storage policy)と、**永続化の実施タイミング**は
別の意思決定である。ある collector が `persist_allowed` な signal を生成しても、
その collector の実装フェーズが実際に永続化するかどうかは、以下のような
運用上のトリガーが発生するまで意図的に先送りしてよい:

1. 診断結果の時系列比較が要件化したとき
2. quota 制限のある値(外部 API 呼出等)が同一 snapshot に含まれるとき
3. 人間が診断結果を review / adopt する UI を要求するとき

---

## Part B — Website Scanner V1 Subset Specification(normative for this collector）

### B.1 Part A との関係

Website Scanner V1 は Part A が定義する global 契約の**実装の 1 つ**である。
Website Scanner V1 は deterministic extraction のみを行う collector であり、
LLM 推論・Gap/Hypothesis 推論を行わない。この性質により、Part A が許容する値の
うち **一部だけ**を使用する(利用しない値を削除するわけではない、A.5.1 / A.9 参照)。

| Part A の概念 | Website Scanner V1 での具体化 |
|---|---|
| `SignalValue`(A.2) | そのまま採用。全 8 型のうち `boolean/string/url/string_list/url_list/none` の 6 型を実際に使用 |
| `DigitalSignal`(A.3) | そのまま採用。`provenance` は常に `"website_scanner_v1"`(B.2） |
| `status`(A.4） | `observed / not_observed / inaccessible` の 3 値のみ生成。`not_applicable` / `absent_confirmed` は**生成しない**(B.5） |
| `Claimability`(A.5） | `FACT_SAFE / INTERNAL_ONLY / DO_NOT_USE` の 3 値のみ生成。`QUESTION_ONLY` は**生成しない**(A.5.1、B.5） |
| `IdentityStatus`(A.6） | `WebsiteIdentityStatus` として具体化。5 値すべてを型として保持するが、`trusted_manual` は V1 の実装では到達不能(B.4） |
| `Provenance`(A.7） | `"website_scanner_v1"` 固定 |
| `StoragePolicy`(A.8） | 全 16 signal が `persist_allowed`。実際の永続化は行わない(Phase 5 まで凍結） |

### B.2 Website Scanner V1 の 16 signals

`WEBSITE_SIGNAL_DEFS`(`lib/website/contract/website-signal-defs.ts`)が単一の実装。

| # | key | value type | default claimability | storage policy |
|---|---|---|---|---|
| 1 | `website_exists` | `boolean` | FACT_SAFE | persist_allowed |
| 2 | `website_title` | `string` | FACT_SAFE | persist_allowed |
| 3 | `website_meta_description` | `string` | FACT_SAFE | persist_allowed |
| 4 | `website_h1` | `string` | FACT_SAFE | persist_allowed |
| 5 | `website_canonical` | `url` | INTERNAL_ONLY | persist_allowed |
| 6 | `website_jsonld_types` | `string_list` | INTERNAL_ONLY | persist_allowed |
| 7 | `website_jsonld_name` | `string` | FACT_SAFE | persist_allowed |
| 8 | `website_jsonld_address` | `string` | FACT_SAFE | persist_allowed |
| 9 | `website_jsonld_phone` | `string` | FACT_SAFE | persist_allowed |
| 10 | `website_phone_links` | `string_list` | FACT_SAFE | persist_allowed |
| 11 | `website_instagram_links` | `url_list` | FACT_SAFE | persist_allowed |
| 12 | `website_menu_links` | `url_list` | FACT_SAFE | persist_allowed |
| 13 | `website_reservation_links` | `url_list` | FACT_SAFE | persist_allowed |
| 14 | `website_booking_destination_domain` | `string` | FACT_SAFE | persist_allowed |
| 15 | `website_booking_destination_type` | `string` | FACT_SAFE | persist_allowed |
| 16 | `website_booking_provider` | `string` | FACT_SAFE | persist_allowed |

`website_canonical` / `website_jsonld_types` の既定 claimability が `INTERNAL_ONLY` な
理由: 営業トークで口に出す性質の情報ではなく、内部診断用の技術メタデータであるため。

#### B.2.1 `website_jsonld_*` scalar は単一 entity 由来でなければならない

`website_jsonld_name` / `website_jsonld_address` / `website_jsonld_phone` は、
**同一の JSON-LD entity node から取得しなければならない。** field ごとに別 node へ
fallback してはならない。

これらの scalar は既定 claimability が `FACT_SAFE` であり、営業の場では「1 つの店舗に
関する 1 組の事実」として読まれる。`Restaurant` の店名と `Organization`(運営会社)の
本社住所を組み合わせて 1 レコードとして提示すると、個々の値は正しいまま**合成された
主張が事実でなくなる**。

`selectPrimaryIdentityNode`(`lib/website/parse/json-ld.ts`）が primary entity を
1 件だけ選ぶ。Phase 1 は StoreIdentity との照合を行わないため、選択規則は保守的である:

| identity node の状況 | primary | `website_jsonld_*` scalar |
|---|---|---|
| strong node がちょうど 1 件 | その node | その node の値 |
| strong node が複数 | なし(ambiguous） | 生成しない(`not_observed`） |
| strong node が 0 件 | なし | 生成しない。`Organization` を店舗 fact へ**昇格させない** |

いずれの場合も `identity_evidence`(§B.4.2）には全 node が strength 付きで保持される
ため、Phase 3 の identity 判定に使える情報は失われない。「scalar signal に出さない」
ことと「evidence として持たない」ことは別である。

**Instagram の派生値**(`instagram_reference_observed` / `primary_instagram_url` /
`instagram_username_from_url`)は `website_instagram_links` から決定的に導出できる
ため、独立した DigitalSignal としては生成しない(pure helper として提供、B.5）。

この 16 件が Website Scanner V1 の formal signal の**全体**である。

### B.3 Contract clarifications(CC-1〜CC-5）

実データ調査により判明した、契約の実装環境への適用に関する明確化事項。
**いずれも contract の欠陥ではなく、実装現実に対する contract の解釈確定である。**

- **CC-1**: `stores.basic_info.official_site` は URL フィールドではない
  (ラベル「公式サイト有無」の自由記述、値は "あり"/"なし" 等を含みうる)。
  Website Scanner V1 の root candidate 解決(B.4）はこのフィールドを
  **一切参照しない**。「公式サイト有無」という定性記述と「サイトの所在（URL）」は
  別概念であり、混同してはならない。
- **CC-2**: `stores.site_url` は `NOT NULL` 列であり、未設定は `null` ではなく
  **空文字列** `""` で表現される。Website Scanner V1 の root candidate 解決は
  `trim() !== ""` を必須条件とする。
- **CC-3**: `BookingDestinationType`(B.2 の `website_booking_destination_type`
  が取りうる値の集合)は `phone_only` を含まない。この値の生成には「電話以外の
  予約手段が存在しない」という absence 判定が必要であり、A.9 の absence semantics
  (「見つからない」≠「存在しない」)と両立しない。電話番号自体は
  `website_phone_links` が独立して保持する。
- **CC-4**: `trusted_manual`(A.6 / B.4）は、既存データから自動判定できないことが
  確認済みである。Website Scanner V1 には人間が明示的に URL を確認する UI が存在
  しないため、この identity status は**型として保持するが、V1 の実行経路では
  到達不能**である。
- **CC-5**: `not_applicable`(A.4）は「観測できなかった」ことを意味しない。
  Website Scanner V1 は、ある signal が構造的に従属し無意味になる場合を
  自ら判定する根拠を持たないため、**この status を生成しない**(B.5）。
- **CC-6**: Website Scanner の User-Agent product token は **`FirstWebResearchAI`** で
  あり、単一定義(`lib/website/user-agent.ts`）から取得しなければならない。
  robots.txt の `User-agent:` 照合には product token を、HTTP リクエストヘッダには
  同 module が組み立てる Mozilla 形式文字列を使う。両者を別々に手書きすると
  「送信している UA 名」と「robots で照合している UA 名」が静かにずれ、
  **事実上 robots.txt の専用セクションを無視する**ことになる。
  follow-up: `lib/url-parser/ogp.ts` は独自の UA 文字列を持ち、product token を
  `Research` ではなく `Reserch` と綴った typo を含んだまま実送信している。
  PR #199 が同ファイルを変更中のため本 PR では触らず、**#199 merge 後に
  `lib/website/user-agent.ts` へ統合する**(§D.2）。

### B.4 Website Scanner 固有の identity trust boundary

`WebsiteIdentityStatus`(A.6 の具体化、`lib/website/contract/identity.ts`）:

```
candidate_known_url   -- root candidate 解決直後の初期状態(B.4.1）
trusted_manual        -- V1 では到達不能(CC-4）
target_match          -- deterministic な照合により確認済み(Phase 3 で実装）
uncertain             -- 照合を試みたが確信を持てなかった
unrelated             -- 明確に対象外
```

#### B.4.1 root candidate 解決と初期 identity

Website Scanner V1 Phase 1 の root candidate は **`stores.site_url` のみ**
(CC-1 / CC-2）。`resolveRootCandidate`(`lib/website/url/resolve-candidates.ts`）が
返す URL の identity は常に `candidate_known_url` から始まり、**trusted ではない**
(A.6）。

`AI Research Source Registry`(`source_type=official_site` かつ
`identity_status=target_match`)を追加候補とすることは、AI Research 基盤
(PR #180)が merge された後の Phase として計画されている。推測 URL の生成は
恒久的に禁止する。

#### B.4.2 identity evidence(Phase 1 で抽出、判定は Phase 3）

Phase 1 は identity **判定**を実装しない。判定に使う evidence の**抽出**のみを行う。

```ts
interface WebsiteIdentityEvidence {
  names: IdentityCandidate[];
  addresses: IdentityCandidate[];
  phones: IdentityCandidate[];
}
interface IdentityCandidate {
  value: string;
  strength: "strong" | "weak";
  source_url: string;
  provenance: "json_ld_strong_entity" | "json_ld_organization" | "h1" | "title" | "tel_link";
}
```

**strength の割り当て規則:**

| 供給源 | strength | 理由 |
|---|---|---|
| `Restaurant` / `FoodEstablishment` / `LocalBusiness` / `BarOrPub` / `CafeOrCoffeeShop` / `Bakery` / `NightClub` の JSON-LD の `name` / `address` / `telephone` | **strong** | 店舗 entity 自身を記述する構造化データ |
| `Organization` の JSON-LD の `name` / `address` / `telephone` | **weak** | 運営会社名は店舗名と一致しないことがある。address / telephone も単独では target_match を成立させる strong evidence として扱わない |
| `<h1>` テキスト | weak(name のみ） | 構造化されていない自由記述 |
| `<title>` テキスト | weak(name のみ） | 同上 |
| `tel:` link | weak(phone のみ） | ページ内のどの entity に属するか保証がない |

**identity evidence から明示的に除外する JSON-LD `@type`:**
`BreadcrumbList` / `WebSite` / `WebPage` / `Article` / `BlogPosting` /
`SiteNavigationElement` / `ItemList` / `SearchAction` / `Person` / `Product` / `Event`

これらは店舗 entity を記述しないため、たとえ `name` フィールドを持っていても
identity evidence には含めない(例: `BreadcrumbList` の `name` は「トップ」
「メニュー」等のナビゲーション文字列であり、店舗名ではない)。

#### B.4.3 判定(Phase 3 で実装、契約としてここに規定）

```
nameHit  := evidence.names のいずれかが店舗名と一致
addrHit  := evidence.addresses のいずれかが店舗住所と一致
phoneHit := evidence.phones のいずれかが店舗電話番号と一致(正規化後）

target_match:
  nameHit AND (addrHit OR phoneHit)

unrelated(3条件すべてを要求、false positive を最優先で避ける）:
  1. !nameHit AND !addrHit AND !phoneHit
  2. AND homepage 由来の strong evidence が存在する
       (strong node が name と (address または telephone) を持つ)
  3. AND 明確な conflicting strong evidence が存在する
       (strong phones が非空かつ店舗電話が非空かつ全て不一致)
       OR (strong addresses が非空かつ店舗住所が非空かつ全て番地レベルで不一致)

それ以外: uncertain
```

**単一の electronic phone mismatch だけでは `unrelated` にしない。** 支店代表番号・
予約専用番号・記載更新漏れ等、正当な不一致が実在するため。

### B.5 Website Scanner V1 が生成しないもの(明示的な非対称）

| Part A の値 | Website Scanner V1 での扱い |
|---|---|
| `status = not_applicable` | **生成しない**(CC-5）。schema の型には残す |
| `status = absent_confirmed` | **生成しない**(A.9）。網羅的確認手段を持たないため |
| `claimability = QUESTION_ONLY` | **生成しない**(A.5.1）。Gap/Hypothesis 推論を行わないため |
| `identity = trusted_manual` | **到達不能**(CC-4）。人間操作 UI が V1 に存在しないため |
| `BookingDestinationType = phone_only` | **型に含めない**(CC-3）。absence semantics と矛盾するため |
| Instagram の followers / posts / last_post / reach | **signal key 自体を生成しない**。Meta API 無しに推測しない |
| 生 HTML の保持 | **行わない**。抽出済みの構造化値のみを扱う |
| 推測 URL の生成 | **行わない**。観測済みリンクのみを候補化する |
| 永続化(DB への保存） | **V1 では行わない**(A.10）。storage policy 上は `persist_allowed` だが、実施は Phase 5 まで凍結 |

### B.6 Crawl politeness(robots.txt）

`lib/website/crawl/robots.ts` は pure parser / evaluator である(network I/O は Phase 2）。

**中心となる不変条件は「解釈できないものを許可しない」である。**
robots.txt は第三者が書いた外部入力であり、構文を理解できないことは crawl してよい
根拠にならない。この方向を誤ると、拒否を表明したサイトを crawl することになる。

- **path matching**: RFC 9309 の `*`(任意の 0 文字以上)と終端 `$`(path 末尾へ固定)を
  実装する。「未対応だから無視して crawl」は禁止。
- **照合対象**: **path + query**(RFC 9309 §2.2.2 / Google robots.txt spec）。
  したがって `Disallow: /*.pdf$` は `/menu.pdf` に一致し、`/menu.pdf?x=1` には一致しない。
  照合対象の組み立ては `robotsTargetFromUrl()` に集約し、呼び出し側ごとに
  path のみ / query 込み がばらつくことを防ぐ。
- **実装手段**: 正規表現を使わない bounded deterministic matcher。glob→RegExp 変換は
  ReDoS および任意 regex 注入の経路になるため採用しない。
- **specificity**: 一致した rule のうち pattern 文字列長が最大のものが勝つ。
  同 specificity なら `Allow` が勝つ(RFC 9309 §2.2.2）。
- **group merge**: 一致する `User-agent` group が複数あれば**全て merge** する
  (RFC 9309 §2.2.1）。専用 UA group が 1 件以上あれば `*` group は混ぜない。
  専用が 0 件なら全 `*` group を merge する。
- **fail-closed**: 解釈できない `Disallow` 行が 1 件でもあれば `failClosed = true` と
  なり、`isAllowedByRobots` は全 path に対して false を返す。解釈できない `Allow` は
  無視しても over-block 方向にしか働かないため fail-closed の対象にしない。
- **Crawl-delay**: access rule ではなく group の **metadata** として扱い、group を
  分割しない。merge 対象 group に複数の有効値があれば最も保守的な**最大値**を採り、
  `[1000, 3000]ms` へ clamp する。malformed / 負値は無視する。

---

## Part C — Change control

- 本 document の改訂は、対応する `lib/website/contract/` の schema / 定数を
  同じ PR で追随させなければならない。
- 各 schema / 定数ファイルの JSDoc には、対応する本 document の節番号
  (例: `Sales Diagnostics Data Contract v1.2 §B.2`)を明記する。
- JSDoc から**実在しないファイル・シンボルを参照しない**。未 merge の PR に依存する
  前方参照を書く場合は、現時点で未存在であることと依存 PR 番号を明記する(§D.2）。
- 新しい collector(Website Scanner 以外)を追加する場合、Part A を変更せず、
  Part B に相当する新しい Part(Part E 以降）を追加する形で拡張する。
  Part A の union から既存の値を削除することは、それを使用する collector が
  ゼロになったことが確認された場合を除き行わない。
- Part A の global union を縮小せずに subset を作る場合、コード側では
  `Website*` のように **collector 名を接頭辞に付けた型名**を用いる(§0）。
  無印の名前を subset へ割り当てない。

---

## Part D — 既知の残課題(Phase 1 時点）

契約違反ではないが、意図的に先送りした事項。新しい設計へ広げず、記録に留める。

### D.1 実装上の既知の割り切り

| # | 事項 | 現在の挙動 | 方向性 |
|---|---|---|---|
| D.1.1 | `canonicalizeUrl` の query 再エンコード | `?q=a%20b` → `?q=a+b`(`URLSearchParams` 由来）。RFC 3986 上は同義で冪等 | 実害が観測された場合に対応 |
| D.1.2 | `filterCrawlCandidateLink` の reason 精度 | canonicalize 由来の `invalid_url` が `disallowed_scheme` として報告される | reason の忠実化 |
| D.1.3 | booking first-party 判定の PSL 非依存 | `effectiveOrigin` が public suffix(例 `co.jp`）の場合に配下が first-party になる。実運用では店舗自身のサイト由来のため到達しない | PSL 導入時に解消 |
| D.1.4 | `www` と apex の別サイト扱い | crawl・first-party 判定とも保守的に別扱い。false positive は起きないが網羅性を落とす | 需要が出れば host 正規化を検討 |
| D.1.5 | `PageObservation.links` は未フィルタ | `javascript:` / `mailto:` を含む生の値。Phase 2 が `filterCrawlCandidateLink` を通す前提 | Phase 2 で必ず filter を通すこと |

なお `website_jsonld_*` scalar が多店舗ページで曖昧になる件(旧 LOW-7）は、
§B.2.1 の primary entity 規則により「曖昧なら生成しない」として解消済みである。

### D.2 外部 PR への依存

| 依存 | 内容 | 解消時にやること |
|---|---|---|
| **PR #199** | `lib/security/safe-http-fetch.ts`(`safeFetchHtml`）。**本 PR の時点では未存在**。SSRF 対策の責務を持つ | Phase 2 の fetch 実装が利用。あわせて `lib/url-parser/ogp.ts` の UA を `lib/website/user-agent.ts` へ統合し、`Reserch` typo を解消する(CC-6） |
| **PR #180** | AI Research 基盤 / `AI Research Source Registry` | `source_type=official_site` かつ `identity_status=target_match` の URL を root candidate の追加候補にする(§B.4.1）。推測 URL の生成は恒久的に禁止 |
