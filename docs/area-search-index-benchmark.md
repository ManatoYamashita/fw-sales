# エリア検索 bbox 候補取得の lat/lng インデックス調査

Issue [#162](https://github.com/ManatoYamashita/fw-sales/issues/162) / PR [#159](https://github.com/ManatoYamashita/fw-sales/pull/159) follow-up

**結論: 現時点では index を追加しない(保留)。** 判定基準・実測値・再評価トリガを以下に記録する。

---

## 1. 背景と対象クエリ

PR #159 で `lib/db/store-repository.ts` の `findAreaSearchCandidates` が導入され、エリア検索の
既存店舗照合は「全件取得」から「exact Place ID または Places 結果の bbox による候補限定」に変わった。

```sql
select * from stores
where google_place_id in ($1, ..., $20)                          -- 既存 index あり
   or (lat >= $21 and lat <= $22 and lng >= $23 and lng <= $24)  -- index なし
order by created_at desc
```

`stores.google_place_id` には `stores_google_place_id_idx` があるが `lat`/`lng` には index が無く、
OR の片腕に index が無いと Postgres は BitmapOr を組めず Seq Scan に倒れる。

- 呼び出し元は `/stores/new` の 3 箇所(初回検索 / もっと読み込む / 追加探索)
- Issue #129 M4 のとおり **1 検索セッションで 10 回以上**呼ばれ得る
- bbox は Places 結果(最大 20 件)の min/max ± `BBOX_MARGIN_DEGREES = 0.001`(`lib/places/match-store.ts`)
- `stores.lat` / `lng` は `real`(float4)の nullable。手動登録経路では必ず NULL になる

## 2. 本番の現状(計測日: 2026-07-19)

`pnpm db:diagnose-area-search` による実測。PostgreSQL 17.6 (Supabase)。

| 項目 | 実測値 |
|------|--------|
| `stores` 行数 | **12** |
| lat/lng とも非 NULL | **0 (0.0%)** |
| `google_place_id` 非 NULL | **0 (0.0%)** |
| heap / total サイズ | 120 kB / 256 kB(平均行 1157 B / planner 幅 552 B) |
| 既存 index | `stores_pkey` (16 kB), `stores_google_place_id_idx` (16 kB) |
| Q3(実クエリ形状)の plan | **Sort > Seq Scan** / planning 0.149ms / execution 0.073ms / Rows Removed by Filter: 12 |

**この規模では planner は index を選ばない**(後述のとおり切り替わるのは 100〜300 行の間)。
Issue が求める「本番相当データ量での `EXPLAIN (ANALYZE, BUFFERS)`」は現在の本番 DB では
原理的に取得できないため、合成データによるベンチで代替した。

## 3. ベンチ手順

```bash
brew install postgresql@17     # 本番 17.6 に合わせる (keg-only)
bash scripts/bench-area-search-index.sh --rows=1000,10000,100000 --null-rates=0.9,0.5,0.1 --runs=50
```

- 一時ディレクトリに使い捨てクラスタを `initdb` し、ポート 55432 で起動 → 終了時に必ず破棄
  (`trap` は EXIT / INT / TERM / HUP / PIPE を捕捉。停止を確認してから削除する)
- スキーマは手書き DDL ではなく**実際の migration チェーン**を適用(ドリフト防止)。
  `drizzle/0004` が `auth.users` への cross-schema FK を持つためスタブのみ用意する
- planner 設定は本番の `pg_settings` 実測値に一致させる。特に `random_page_cost` は
  本番 1.1 に対し PostgreSQL 既定が 4.0 で、既定のままだと index scan を不当に不利に評価する
- 本番 DB には接続しない。`DATABASE_URL` を読まず `BENCH_DATABASE_URL` のみを使い、
  接続先が localhost の bench ポートでなければ即終了する

### 合成データの設計

- **地理分布**: 80% を都市中心 20 点から ±0.05°(≒5km)、20% を日本全域 bbox に一様。
  一様のみだと bbox 選択率が非現実的に低く出て index を過大評価し、都市集中のみだと逆に過小評価する
- **列間相関**: lat/lng が入る行は Places 経由なので `google_place_id` も入る。独立に乱数生成しない。
  さらに「Places で見つけたが座標欠損」を模す 2% だけ place_id 非 NULL / lat NULL にする
- **列幅**: 本番の `pg_stats` 実測(`memo` の avg_width 216B が支配的、`basic_info` は実質空)を再現。
  結果の planner 幅は 640〜657B(本番 `pg_stats` 合計 552B / 本番 EXPLAIN width 680B)
- **決定性**: 行ごとの擬似乱数は `md5(salt:seed:i)` から導出する。`random()` を相関のない
  LATERAL 副問い合わせで使うと Postgres が 1 度だけ評価して全行で同じ値を使い回し、
  NULL 率の指定が効かなくなる(実際に踏んだ)

### 本番と乖離する点とバイアスの向き

| 乖離 | 内容 | バイアスの向き |
|------|------|----------------|
| `effective_io_concurrency` | macOS は posix_fadvise を欠くため 0 固定(本番 200) | Bitmap Heap Scan の先読みが効かず **index に不利**(保守的) |
| キャッシュ状態 | shared_buffers 224MB > テーブル最大 65MB。全て warm | Seq Scan が最良ケース。**index に不利**(保守的) |
| locale | `C`(照合が速い) | `ORDER BY` の Sort が速く、Seq Scan + Sort に有利。**index に不利**(保守的) |
| `fsync` 等 | off | 投入の高速化のみ。読み取り計測には影響しない |
| PG バージョン | 17.10 (bench) / 17.6 (本番) | patch レベル差のみ |
| `memo` の内容 | 固定文字列の繰り返し | 実データより圧縮が効きやすい可能性 |
| 同時負荷 | 無し | 本番は他クエリと競合しうる |

**主要な乖離はいずれも index に不利な方向**である。したがって実運用での index の恩恵は、
本ベンチの測定値より**大きくなる可能性がある**。この点は下記の再評価トリガに織り込んである。

## 4. 候補 index

| ID | DDL | 備考 |
|----|-----|------|
| C0 | (追加なし) | ベースライン |
| C1 | `(lat, lng)` 複合 btree | Drizzle の schema.ts で表現できる |
| C2 | `(lat)` + `(lng)` 個別 2 本 | BitmapAnd が組める。書き込みコスト 2 本分 |
| C3 | `(lat, lng) WHERE lat IS NOT NULL AND lng IS NOT NULL` | 部分。Drizzle で表現できず raw SQL が必要 |
| C4 | `(lat)` + `(lng)` 部分個別 | 同上 |

### 測定しなかった候補と理由

- **`INCLUDE` による covering index**: 呼び出しが `select()` = 全列(jsonb 含む)のため
  Index Only Scan は原理的に成立しない
- **PostGIS + GiST (C5)**: 本件の条件は**軸平行の矩形範囲**であり、半径検索でも距離順 KNN でもない。
  btree で必要十分。Supabase の extension 追加は運用依存を増やすため採らない。
  真の半径検索や `ORDER BY distance` に移行する時が再検討タイミング

## 5. 結果

### 5-1. 行数と Q3(実クエリ形状)中央値 — nullRate 0.5

| 行数 | C0 (index なし) | C1 (lat,lng 複合) | 絶対差 | 相対 | planner の選択 |
|------|-----------------|-------------------|--------|------|----------------|
| 100 | 0.546 ms | 0.409 ms | 0.14 ms | -25% | **Seq Scan**(index を使わない) |
| 300 | 0.361 ms | 0.304 ms | 0.06 ms | -16% | Bitmap Heap Scan に切替 |
| 1,000 | 1.346 ms | 0.937 ms | 0.41 ms | -30% | Bitmap Heap Scan |
| 10,000 | 2.400 ms | 0.521 ms | **1.88 ms** | -78% | Bitmap Heap Scan |
| 20,000 | 4.499 ms | 0.566 ms | 3.93 ms | -87% | Bitmap Heap Scan |
| 50,000 | 10.750 ms | 0.685 ms | 10.07 ms | -94% | Bitmap Heap Scan |
| 100,000 | 14.815 ms | 0.973 ms | 13.84 ms | -93% | Bitmap Heap Scan |

- **planner が Seq Scan から index へ切り替わるのは 100〜300 行の間**
- **絶対差が 5 ms を超えるのは 20,000〜50,000 行の間(内挿で約 25,000 行)**

### 5-2. 候補間比較(10,000 行 / runs=50)

Q3 中央値 (ms) と index サイズ:

| 候補 | NULL率0.9 | NULL率0.5 | NULL率0.1 | サイズ(NULL率0.5) |
|------|-----------|-----------|-----------|-------------------|
| C1 複合 | 0.510 / 240kB | 0.521 / 240kB | 0.501 / 240kB | 240 kB |
| C2 個別 | 0.531 / 480kB | 0.540 / 480kB | 0.581 / 480kB | 480 kB |
| C3 部分複合 | 0.404 / 40kB | 0.477 / 128kB | 0.512 / 216kB | 128 kB |
| C4 部分個別 | 0.477 / 80kB | 0.527 / 256kB | 0.566 / 432kB | 256 kB |

**実行時間は 4 候補ともノイズの範囲で拮抗**し、差は主に index サイズに現れる。
部分 index は NULL 率が高いほど小さくなる(NULL 率 0.9 で C3 は C1 の 1/6)。

採用する場合の推奨は **C1(複合・非部分)**:

- 実行時間は最速帯で、C2/C4 の半分のサイズ・index 1 本で済む
- `stores` は `mergeBasicInfo` 由来の UPDATE が頻繁なので index 本数は少ない方がよい
- **Drizzle の schema.ts で表現できる**。部分 index は Drizzle が `WHERE` を出力できないため
  raw SQL 追記が必要になり、次回以降の `pnpm db:generate` が重複 `CREATE INDEX` を吐く罠を抱える
  (前例: `drizzle/0010_add_ai_prompt_templates.sql`)。サイズ差は絶対値では数百 kB に過ぎず、
  この保守上の危険を負う価値がない

### 5-3. `real` 列 × `double precision` パラメータの cross-type 検証

**結果: 問題なし。両形式とも `Index Cond` に現れ、index で範囲制限できている。**

```
C1 (lat,lng) 複合
   bind   : Index Cond → ((lat >= '35.671192'::real) AND (lat <= '35.691208'::real)
                          AND (lng >= '139.7571'::real) AND (lng <= '139.77711'::real))
   literal: Index Cond → ((lat >= '35.671190990990986'::double precision) AND ...)
```

バインドパラメータは `::real` へ、リテラルは `double precision` のまま解決されるが、
いずれも `float_ops` opfamily の cross-type 演算子で index が使える。`Filter` への落下は起きない。
列型の変更(`real` → `double precision`)は不要。

なお float4 の有効桁は約 7 桁(緯度で約 1m の丸め)で、`BBOX_MARGIN_DEGREES = 0.001`(約 111m)
に対して無視できる。

### 5-4. `enable_seqscan=off` 対照(推定コスト)

| 行数 | C0 Seq Scan cost | C1 index 強制 cost |
|------|------------------|--------------------|
| 1,000 | 109.53 | 25.80 |
| 10,000 | 1,084.53 | 46.83 |
| 100,000 | 10,806.52 | 71.61 |

Seq Scan のコストは行数に線形、index パスはほぼ横ばい。行数が増えるほど差は開く。

## 6. 判定

### 事前に定義した採用基準(実行前に確定)

1. **10,000 行**かつ本番相当の NULL ミックスで、Q3 中央値が C0 比で
   **30% 以上かつ絶対値で 5 ms 以上**改善する
2. **1 セッション換算(10 回 ×(planning + execution))**でも index ありが下回る
3. `enable_seqscan` を触らずに planner が実際に index パスを選ぶ
4. bbox 境界が `Index Cond` に現れる

絶対閾値を置いたのは、エリア検索の E2E レイテンシが **Google Places API の往復(100〜500ms 級)**に
支配されるためである。0.2ms → 0.1ms のような改善は運用上の意味を持たない。

### 判定結果

| 基準 | 結果 |
|------|------|
| 1. 10,000 行で 30% 以上 **かつ** 5ms 以上 | **不成立** — 相対 -78% は満たすが絶対差 1.88 ms(< 5 ms) |
| 2. 1 セッション換算 | 成立(C0 20.9 ms → C1 1.19 ms) |
| 3. planner が自然に index を選ぶ | 成立(300 行以上) |
| 4. `Index Cond` に現れる | 成立 |

**基準 1 が不成立のため、事前定義したゲートにより「保留」と判定する。**

決め手は本番の実データ規模である。`stores` は現在 **12 行**で、planner が index を使い始める
100〜300 行にすら達していない。絶対差が意味を持ち始める 25,000 行とは 3 桁の開きがある。
この状態で index を追加しても、検証不能な書き込みコストを恒久的に負うだけになる。

## 7. 再評価トリガ

以下のいずれかを満たしたら再判定する。

- `stores` の行数が **10,000 行**を超える
- lat/lng がともに非 NULL の行が **5,000 行**を超える

```bash
pnpm db:diagnose-area-search
```

実測のクロスオーバーは約 25,000 行だが、トリガは意図的に**それより低い 10,000 行**に置いた。
§3 のとおりベンチの主要な乖離(warm cache、macOS の prefetch 制限、locale=C)がいずれも
**index に不利な方向**であり、実運用での恩恵が測定値より大きくなる可能性があるためである。

再判定で採用となった場合の手順は §8 を参照。

## 8. 採用する場合の migration 手順(将来用)

**前提**: `#161` が main にマージされ `drizzle/0023_*` `0024_*` と journal idx 23/24 が存在すること。
`jq '.entries[-1]' drizzle/meta/_journal.json` で確認する。

`lib/db/schema.ts` の `stores` 定義末尾に 1 行追加する。

```ts
}, (table) => [
  index("stores_google_place_id_idx").on(table.google_place_id),
  // エリア検索の bbox 候補取得 (findAreaSearchCandidates / Issue #162) 用。
  // 選定根拠とベンチ結果: docs/area-search-index-benchmark.md
  index("stores_lat_lng_idx").on(table.lat, table.lng),
]);
```

```bash
pnpm db:generate --name=add_store_latlng_index   # --name で自動生成タグを避け journal の tag 手修正を不要にする
pnpm db:check                                    # journal 整合を検証
```

- `_journal.json` は**手書き編集しない**(`pnpm db:generate` に刻ませる)
- `stores_google_place_id_idx` は OR の一方の腕が使うので**削除しない**(追加のみ)
- 適用は main マージで `migrate.yml` が自動実行する。手動 DDL は行わない
- 取り消す場合は 0025 を書き換えず **0026 として前進的に** `DROP INDEX` する
  (水位線の性質上、既適用 migration の編集は無効)

### `CONCURRENTLY` を使わない理由

1. リポジトリに使用実績がゼロ
2. `CREATE INDEX CONCURRENTLY` はトランザクションブロック内で実行できず、
   drizzle-kit が breakpoints 付き migration をトランザクションで包む方式と両立しない
3. 現在の規模ではロック時間が問題にならない

再検討条件: `stores` が 10 万行を超えた場合。その時は raw SQL migration で
`CREATE INDEX CONCURRENTLY` を単独実行する(breakpoints を無効化した専用 migration が必要)。

## 9. エリア検索全体の p95 について

Issue の「エリア検索全体の p95 レイテンシ計測」は、DB 部分を本ベンチで精密に測定した。

- **DB 部分**: 現在の本番規模で execution 0.073 ms / planning 0.149 ms。
  10,000 行に成長しても C0 で 2.4 ms
- **Google Places API 部分**: `searchPlacesPage` + `resolveSearchCenter` の往復。
  外部 API のため 100〜500 ms 級

DB 部分が E2E に占める割合は現状 **1% 未満**であり、10,000 行規模でも数 % に留まる。
index 追加による体感の変化は生じない。これが本調査で index を保留とする定量的根拠でもある。

エリア検索の体感を改善したい場合、投資先は DB index ではなく Places API 呼び出し
(直列実行の見直し、キャッシュ、ページング戦略)である。ただし現状の直列実行は
Places 結果から bbox を組み立てる依存関係上避けられない(PR #159 で確認済み)。

## 10. 関連

- Issue [#129](https://github.com/ManatoYamashita/fw-sales/issues/129)(M4: エリア検索の全件 scan 回避)
- PR [#159](https://github.com/ManatoYamashita/fw-sales/pull/159)(`findAreaSearchCandidates` の導入)
- `scripts/bench-area-search-index.sh` / `.mjs`(本調査の再実行手段)
- `scripts/diagnose-area-search-plan.mjs`(`pnpm db:diagnose-area-search`。再評価用)
