# エリア検索 bbox 候補取得の lat/lng インデックス調査

Issue [#162](https://github.com/ManatoYamashita/fw-sales/issues/162) / PR [#159](https://github.com/ManatoYamashita/fw-sales/pull/159) follow-up

**結論: 現時点では index を追加しない(保留)。** 判定基準・実測値・再評価トリガを以下に記録する。

> **2026-07-19 改訂**: PR #166 のレビュー指摘を受けて次を修正した。結論は変わっていない。
> - ベンチのワークロードが実リクエストの相関(IN リストと bbox が同一 Places レスポンス由来)を
>   再現していなかったため修正し、§5 の全数値を再計測した(§3「ワークロードの相関」)
> - 「部分 index は Drizzle で表現できない」は誤りだったため訂正し、候補選定を再評価した(§4, §5-2)
> - E2E p95 が未計測であることを明記し、判定根拠から外した(§9)
> - 再判定が診断コマンド 1 本ではできないため、3 段階の手順に書き換えた(§7)
> - ベンチの誤爆防止を番兵方式に強化した(§3「誤爆防止」)

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

主な引数: `--rows` 行数ティア / `--null-rates` 座標 NULL 率 / `--hit-rates` IN リストのヒット率 /
`--bbox-radius` 探索半径[m] / `--bbox-center` 都市中心の添字 / `--seed` / `--runs`。

- 一時ディレクトリに使い捨てクラスタを `initdb` し、ポート 55432 で起動 → 終了時に必ず破棄
  (`trap` は EXIT / INT / TERM / HUP / PIPE を捕捉。停止を確認してから削除する)
- スキーマは手書き DDL ではなく**実際の migration チェーン**を適用(ドリフト防止)。
  `drizzle/0004` が `auth.users` への cross-schema FK を持つためスタブのみ用意する
- planner 設定は本番の `pg_settings` 実測値に一致させる。特に `random_page_cost` は
  本番 1.1 に対し PostgreSQL 既定が 4.0 で、既定のままだと index scan を不当に不利に評価する
- 本番 DB には接続しない。`DATABASE_URL` を読まず `BENCH_DATABASE_URL` のみを使う

### 誤爆防止(番兵方式)

host / port の一致だけでは防御にならない。`BENCH_PG_PORT` 自体が利用者の環境変数であり、
URL とポートを揃えれば既存のローカル DB に到達できてしまう(独立した第三者による検証ではない)。

そのため `.sh` はクラスタ生成時にランダムな nonce を持つ番兵テーブル `bench_sentinel` を作り、
`.mjs` は **破壊操作 (TRUNCATE / INSERT / CREATE INDEX) の直前**に次の 3 点を照合する。

| 検証項目 | 何を保証するか |
|----------|----------------|
| `current_database()` | ラッパーが `createdb` した DB 名であること |
| `current_setting('data_directory')` | ラッパーが `mktemp` で作った一意な PGDATA であること。本番と一致することは原理的にない |
| `bench_sentinel.token` | ラッパーが本プロセス用に生成した nonce であること |

3 点とも環境変数を揃えるだけでは満たせない。取得に失敗した場合(テーブル不在・権限不足など)は
fail-closed とする。破壊操作を行う関数はすべて先頭でこの検証済みフラグを要求するため、
新しい破壊操作を追加しても素通りしない。

### ワークロードの相関

`findAreaSearchCandidates` では、IN リストの Place ID と bbox は**同一の Places レスポンス**に
由来する。つまり ID が指す店舗は必ず bbox の内側にあり、OR の 2 つの腕は相関している。
この相関は BitmapOr のコストと選択率の見積もりに効くため、ベンチでも再現する必要がある。

- IN リストは bbox の**内側**の行から `order by md5(google_place_id)` で決定的に採る
  (heap 物理順に依存しないので seed が同じなら再現する)
- 20 件すべてが既存店舗に一致するとは限らない。`--hit-rates` で一致割合を制御し、
  残りは存在しない ID(= Places が見つけた未登録店舗)で埋める
- bbox 内の候補が要求数に満たない場合は不足分もパディングし、**実ヒット率をログと JSON に記録**する

> 初版のベンチは `ORDER BY` なしの `limit 20`(= heap 先頭 20 件)と固定の東京 bbox を
> 独立に選んでおり、2 つの腕がほとんど交わらない非現実的な組み合わせを測っていた。
> §5 の数値はすべて相関を再現した再計測値である。

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
| C1 | `(lat, lng)` 複合 btree | index 1 本 |
| C2 | `(lat)` + `(lng)` 個別 2 本 | BitmapAnd が組める。書き込みコスト 2 本分 |
| C3 | `(lat, lng) WHERE lat IS NOT NULL AND lng IS NOT NULL` | 部分。NULL 率が高いほど小さい |
| C4 | `(lat)` + `(lng)` 部分個別 | 部分 × 2 本 |

4 候補とも **Drizzle の `schema.ts` で表現できる**。部分 index も例外ではない。

```ts
index("stores_lat_lng_idx").on(table.lat, table.lng)
  .where(sql`${table.lat} is not null and ${table.lng} is not null`)
```

`IndexBuilder.where(condition: SQL)` は `drizzle-orm@0.45.2` に存在し
(`node_modules/drizzle-orm/pg-core/indexes.d.ts:67`、実装は `indexes.js:92`)、
`drizzle-kit@0.31.10` も `WHERE` 句を SQL に出力する。`uniqueIndex()` も
`IndexBuilderOn → .on() → IndexBuilder` を経由するため同様に `.where()` を繋げられる。

> **訂正 (2026-07-19)**: 本ドキュメントは当初「部分 index は Drizzle で表現できず raw SQL が
> 必要」と記載していたが誤りだった。`drizzle/0010_add_ai_prompt_templates.sql` のコメントに
> ある同趣旨の記述は 0010 作成当時の判断であり、現行バージョンでは成立しない
> (0010 の SQL 自体は適用済みのため変更しない)。この誤りは §6 で C1 を推奨する論拠の
> 1 つになっていたため、候補選定を再評価した。

### 測定しなかった候補と理由

- **`INCLUDE` による covering index**: 呼び出しが `select()` = 全列(jsonb 含む)のため
  Index Only Scan は原理的に成立しない
- **PostGIS + GiST (C5)**: 本件の条件は**軸平行の矩形範囲**であり、半径検索でも距離順 KNN でもない。
  btree で必要十分。Supabase の extension 追加は運用依存を増やすため採らない。
  真の半径検索や `ORDER BY distance` に移行する時が再検討タイミング

## 5. 結果

> すべて **IN リストと bbox が相関するワークロード**(§3「ワークロードの相関」)での再計測値である。
> 相関のない初版の測定値からは、絶対差が 10,000 行で 1.88 ms → 2.55 ms に拡大している
> (index に有利な方向へ動いた)。

### 5-1. 行数と Q3(実クエリ形状) — nullRate 0.5 / hitRate 0.25 / runs=20

| 行数 | C0 中央値 | C0 p95 | C1 中央値 | C1 p95 | 絶対差 | 相対 | planner の選択 (C1) |
|------|-----------|--------|-----------|--------|--------|------|---------------------|
| 100 | 0.292 ms | 0.51 ms | 0.306 ms | 1.46 ms | -0.01 ms | +5% | **Seq Scan**(index を使わない) |
| 300 | 0.317 ms | 2.45 ms | 0.266 ms | 3.30 ms | 0.05 ms | -16% | Bitmap Heap Scan に切替 |
| 1,000 | 0.421 ms | 0.57 ms | 0.274 ms | 1.16 ms | 0.15 ms | -35% | Bitmap Heap Scan |
| 10,000 | 2.839 ms | 3.55 ms | 0.289 ms | 0.83 ms | **2.55 ms** | -90% | Bitmap Heap Scan |
| 20,000 | 4.921 ms | 5.49 ms | 0.427 ms | 0.54 ms | 4.49 ms | -91% | Bitmap Heap Scan |
| 50,000 | 11.061 ms | 14.76 ms | 0.674 ms | 3.64 ms | 10.39 ms | -94% | Bitmap Heap Scan |
| 100,000 | 14.798 ms | 16.38 ms | 0.741 ms | 0.90 ms | 14.06 ms | -95% | Bitmap Heap Scan |

- **planner が Seq Scan から index へ切り替わるのは 100〜300 行の間**
- **絶対差が 5 ms を超えるのは 20,000〜50,000 行の間(内挿で約 22,600 行)**
- 100 行では C0/C1 とも Seq Scan で、差は計測ノイズ(C1 がわずかに遅い)

p95 は runs=20 の標本なので外れ値 1 点に強く引かれる。傾向の確認用であり、
判定には中央値を用いる(基準は §6)。

### 5-2. 候補間比較(10,000 行 / runs=50 / hitRate 0.25)

Q3 の 中央値 / p95 / index サイズ:

| 候補 | NULL率 0.9 | NULL率 0.5 | NULL率 0.1 |
|------|------------|------------|------------|
| C0 なし | 2.524 / 3.284 / — | 2.391 / 3.129 / — | 2.327 / 2.726 / — |
| C1 複合 | 0.443 / 2.243 / 240kB | 0.360 / 0.453 / 240kB | 0.395 / 0.580 / 240kB |
| C2 個別 | 0.333 / 0.423 / 480kB | 0.357 / 0.462 / 480kB | 0.469 / 0.674 / 480kB |
| C3 部分複合 | 0.336 / 0.541 / **40kB** | 0.344 / 0.432 / 128kB | 0.421 / 0.737 / 216kB |
| C4 部分個別 | 0.357 / 0.501 / 80kB | 0.425 / 0.690 / 256kB | 0.430 / 0.643 / 432kB |

**実行時間は 4 候補ともノイズの範囲で拮抗**(0.33〜0.47 ms)し、有意差は index サイズにのみ現れる。
部分 index は NULL 率が高いほど小さくなり、NULL 率 0.9 で C3 は C1 の **1/6**(40kB 対 240kB)。

#### 採用する場合の推奨: NULL 率で選ぶ

初版は「部分 index は Drizzle で表現できない」という誤った前提(§4 の訂正)から C1 を推奨していた。
その制約が存在しない以上、C1 と C3 は保守性で同格であり、**実データの NULL 率で選ぶのが妥当**である。

| 実データの状態 | 推奨 | 理由 |
|----------------|------|------|
| lat/lng の NULL 率が高い (> 50%) | **C3** `(lat,lng)` 部分 | 実行時間は同等でサイズが大幅に小さい。NULL 行は bbox 条件に決して合致しないので index に載せる意味がない |
| NULL 率が低い (< 50%) | **C1** `(lat,lng)` 複合 | 部分述語の管理コストに見合うサイズ差が無くなる。定義が単純 |

- C2 / C4(個別 2 本)は採らない。実行時間の優位が無く、サイズが 2 倍で、
  `stores` は `mergeBasicInfo` 由来の UPDATE が頻繁なので index 本数は少ない方がよい
- **現時点の本番は lat/lng 非 NULL が 0 行**(NULL 率 100%)であり、この表に素直に当てはめれば
  C3 が選ばれる。ただし再評価時点の実分布で判断し直すこと(§7)
- 部分 index を採る場合、bbox 条件 `lat >= x and lat <= y` は `lat is not null` を含意するため、
  クエリ側に `is not null` を書き足す必要はない(§5-3 のとおり `Index Cond` に現れている)

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

| 行数 | C0 Seq Scan cost | C1 index 強制 cost | planner の自然な選択 |
|------|------------------|--------------------|----------------------|
| 100 | 12.03 | 12.72 | Seq Scan |
| 300 | 33.03 | 19.09 | Bitmap Heap Scan |
| 1,000 | 109.53 | 25.80 | Bitmap Heap Scan |
| 10,000 | 1,084.53 | 46.83 | Bitmap Heap Scan |
| 20,000 | 2,167.56 | 54.51 | Bitmap Heap Scan |
| 50,000 | 5,417.60 | 62.42 | Bitmap Heap Scan |
| 100,000 | 10,806.52 | 69.62 | Bitmap Heap Scan |

Seq Scan のコストは行数に線形、index パスはほぼ横ばい。行数が増えるほど差は開く。
100 行では index パスの推定コストが Seq Scan を**上回る**(12.72 > 12.03)。
planner が 100 行で index を選ばないのは正しい判断であり、§5-1 の実測とも一致する。

### 5-5. IN リストのヒット率スイープ(10,000 行 / nullRate 0.5 / runs=50)

実運用では Places が返す 20 件のうち何件が既存店舗に一致するかが変動する。
その感度を測った。

| 要求 hitRate | 実ヒット率 | bbox 内の行数 | C0 中央値 | C1 中央値 | C3 中央値 |
|--------------|-----------|---------------|-----------|-----------|-----------|
| 0.0 | 0% (0/20) | 8 | 2.361 ms | 0.400 ms | 0.370 ms |
| 0.25 | 25% (5/20) | 8 | 2.440 ms | 0.301 ms | 0.290 ms |
| 0.5 | 40% (8/20) | 8 | 2.297 ms | 0.304 ms | 0.306 ms |
| 1.0 | 40% (8/20) | 8 | 2.081 ms | 0.297 ms | 0.348 ms |

**ヒット率は結論に影響しない。** C0/C1 の差は全域で 1.7〜2.1 ms のまま動かない。

理由は bbox 側の選択率が支配的だからである。10,000 行のうち半径 1km の bbox に入るのは
**8 行(0.08%)**しかなく、IN リストの一致件数を増やそうとしても bbox 内の候補が尽きる
(要求 0.5 / 1.0 がいずれも実ヒット率 40% で頭打ちになっているのはこのため)。

これ自体が重要な観測である。**実リクエストにおいて OR の 2 つの腕は、原理的に大きく
重なりようがない**。bbox は地理的にごく狭く、そこに既存店舗が密集していない限り、
IN リストの大半は「Places が見つけた未登録店舗」= どちらの腕にも一致しない ID になる。

## 6. 判定

### 事前に定義した採用基準(実行前に確定)

1. **10,000 行**かつ本番相当の NULL ミックスで、Q3 中央値が C0 比で
   **30% 以上かつ絶対値で 5 ms 以上**改善する
2. **1 セッション換算(10 回 ×(planning + execution))**でも index ありが下回る
3. `enable_seqscan` を触らずに planner が実際に index パスを選ぶ
4. bbox 境界が `Index Cond` に現れる

相対値だけを見ると -90% は大きく見えるが、母数が 2.8 ms では 0.3 ms への短縮でしかない。
絶対閾値は、その種の「比率は大きいが実額の小さい」改善をゲートで落とすために置いた。

**5 ms という値は運用上の判断値であり、E2E レイテンシの実測に基づくものではない。**
エリア検索は Places API への HTTP 往復を同期的に含むため、DB 側の数 ms は本来その中に埋もれる。
どこから埋もれなくなるかを実測で確かめてはいない(§9)。ここでは「外部 API 往復を伴う同期処理の
なかで DB 側の改善が観測可能になる下限」として 5 ms を置き、**計測前に確定させた**。
閾値の妥当性そのものは、E2E p95 を実測するまで検証されない。

### 判定結果

| 基準 | 結果 |
|------|------|
| 1. 10,000 行で 30% 以上 **かつ** 5ms 以上 | **不成立** — 相対 -90% は満たすが絶対差 2.55 ms(< 5 ms) |
| 2. 1 セッション換算 | 成立(C0 20.3 ms → C1 0.90 ms / C3 0.93 ms) |
| 3. planner が自然に index を選ぶ | 成立(300 行以上) |
| 4. `Index Cond` に現れる | 成立 |

**基準 1 が不成立のため、事前定義したゲートにより「保留」と判定する。**

決め手は本番の実データ規模である。`stores` は現在 **12 行**で、planner が index を使い始める
100〜300 行にすら達していない。絶対差が閾値を超える約 22,600 行とは 3 桁の開きがある。
この状態で index を追加しても、検証不能な書き込みコストを恒久的に負うだけになる。

なお §5 の再計測(ワークロードの相関を修正)で絶対差は 1.88 ms → 2.55 ms に拡大し、
クロスオーバーは約 25,000 行 → 約 22,600 行に下がった。**index に有利な方向に動いたが、
基準 1 を覆すには至らなかった**ため結論は変わらない。

## 7. 再評価トリガ

以下のいずれかを満たしたら再判定する。

- `stores` の行数が **10,000 行**を超える
- lat/lng がともに非 NULL の行が **5,000 行**を超える

実測のクロスオーバーは約 22,600 行だが、トリガは意図的に**それより低い 10,000 行**に置いた。
§3 のとおりベンチの主要な乖離(warm cache、macOS の prefetch 制限、locale=C)がいずれも
**index に不利な方向**であり、実運用での恩恵が測定値より大きくなる可能性があるためである。

### 再判定の手順

診断スクリプトだけでは再判定できない。**現状の plan しか見えず、C0(index なし)と
C1/C3(index あり)の差は測れない**ためである。実 index を張るのは DDL なので本番では行わない。
そこで次の 3 段階を踏む。

**手順 1 — 実分布を観測する**

```bash
pnpm db:diagnose-area-search
```

行数・NULL 率・現行 plan に加えて、末尾に**手順 2 用のコマンドが実分布を反映した形で出力される**。
HypoPG 拡張が既に有効な DB であれば、仮想 index による C0 / C1 / C3 の推定コスト比較も併せて出る
(拡張の導入 = `CREATE EXTENSION` は DDL なのでスクリプトからは行わない。あくまで既存時のみ)。
なお HypoPG が出すのは**推定コストであって実行時間ではない**。当たりを付ける用途に留める。

**手順 2 — 使い捨てクラスタで実測差を採る**

手順 1 が出力したコマンドをそのまま実行する。形は次のとおり。

```bash
bash scripts/bench-area-search-index.sh --rows=<実測ティア> --null-rates=<実測NULL率> \
  --hit-rates=0.25 --runs=50
```

これで C0 / C1 / C2 / C3 / C4 の中央値・p95・index サイズ・plan 形状が同一条件で並ぶ。
`--hit-rates` は DB から観測できない(Places のレスポンス次第)ため既定 0.25 を置いている。
§5-5 のとおり結論への感度は低いが、実運用の肌感と大きくずれるなら上書きすること。

**手順 3 — 判定基準を再適用する**

§6 の 4 基準に手順 2 の実測値を当てはめる。採用となった場合、候補は §5-2 の
「NULL 率で選ぶ」表に従って決める(高 NULL 率なら C3、低 NULL 率なら C1)。
migration 手順は §8 を参照。

## 8. 採用する場合の migration 手順(将来用)

**前提**: `#161` が main にマージされ `drizzle/0023_*` `0024_*` と journal idx 23/24 が存在すること。
`jq '.entries[-1]' drizzle/meta/_journal.json` で確認する。

`lib/db/schema.ts` の `stores` 定義末尾に 1 行追加する。§5-2 の表で選んだ候補に応じて
どちらかを使う。どちらも Drizzle で表現でき、raw SQL の追記は不要である(§4)。

```ts
}, (table) => [
  index("stores_google_place_id_idx").on(table.google_place_id),
  // エリア検索の bbox 候補取得 (findAreaSearchCandidates / Issue #162) 用。
  // 選定根拠とベンチ結果: docs/area-search-index-benchmark.md

  // C1 — NULL 率が低い (< 50%) 場合
  index("stores_lat_lng_idx").on(table.lat, table.lng),

  // C3 — NULL 率が高い (> 50%) 場合。上の C1 と排他で、どちらか一方だけを置く
  // index("stores_lat_lng_idx").on(table.lat, table.lng)
  //   .where(sql`${table.lat} is not null and ${table.lng} is not null`),
]);
```

C3 を選ぶ場合は `sql` を `drizzle-orm` から import する。生成された migration が
`WHERE` 句を含むことを目視確認すること。

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

## 9. エリア検索全体の p95 — 未計測(Issue #162 の未達項目)

Issue #162 は「エリア検索全体の p95 レイテンシを計測し、Google Places API + DB 候補取得の
直列実行による合算時間を観測する」ことを求めている。**本調査はこれを満たしていない。**

| 区間 | 状態 |
|------|------|
| DB 候補取得 | **実測済み**。本番規模で execution 0.073 ms / planning 0.149 ms。10,000 行で C0 中央値 2.839 ms(§5-1) |
| `resolveSearchCenter` + `searchPlacesPage` | **未計測** |
| E2E 合算 | **未計測**。p50 / p95 とも算出していない |

計測しているのは DB 単体であり、しかも §5 の統計量は中央値である
(p95 は §5-1 / §5-2 に併記したが、これも DB 単体の値でサンプル数は 20〜50)。

> **初版からの訂正 (2026-07-19)**: 初版はここで Places API を「100〜500 ms 級」と記し、
> 「DB 部分が E2E に占める割合は 1% 未満」と述べていた。この 100〜500 ms は外部 API 一般の
> 概算であって本プロジェクトでの実測値ではなく、割合の主張は未計測の分母に依存していた。
> **定量的根拠としては成立しないため撤回し、§6 の判定根拠からも外した。**
> §6 の判定は DB 側の実測値のみで閉じている(絶対差 2.55 ms < 閾値 5 ms、本番 12 行、
> planner の切り替えは 100〜300 行)。

### 残作業

E2E p95 の実測は Issue #162 に未達項目として残す(本 PR では #162 を close しない)。
実施する場合に必要なこと:

- `resolveSearchCenter` / `searchPlacesPage` / DB 候補取得の区間別計時
- 十分なサンプル数と、p50 / p95 / サンプル数の記録
- Google Places API を実際に叩くため、課金とクォータ消費を伴う

これが揃うまで、§6 の絶対閾値 5 ms が妥当な水準かどうかは検証されていない。

### 定性的な見立て(根拠としては使わない)

エリア検索は Places API への HTTP 往復を同期的に含むため、DB 側の数 ms が体感を支配する
とは考えにくい。改善の投資先としては Places API 呼び出し(キャッシュ、ページング戦略)の方が
有望に見える。ただし現状の直列実行は Places 結果から bbox を組み立てる依存関係上避けられない
(PR #159 で確認済み)。**これは実測に裏付けられた主張ではなく、判定には用いていない。**

## 10. 関連

- Issue [#129](https://github.com/ManatoYamashita/fw-sales/issues/129)(M4: エリア検索の全件 scan 回避)
- PR [#159](https://github.com/ManatoYamashita/fw-sales/pull/159)(`findAreaSearchCandidates` の導入)
- `scripts/bench-area-search-index.sh` / `.mjs`(本調査の再実行手段)
- `scripts/diagnose-area-search-plan.mjs`(`pnpm db:diagnose-area-search`。再評価用)
