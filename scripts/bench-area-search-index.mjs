/**
 * エリア検索 bbox 候補取得 (findAreaSearchCandidates) の index ベンチマーク (Issue #162)。
 *
 * lib/db/store-repository.ts の findAreaSearchCandidates が発行するクエリ形状
 * (google_place_id IN (...) OR bbox 範囲) を合成データ上で再現し、index 候補ごとに
 * 実行時間と実行計画を比較する。
 *
 * 実行は scripts/bench-area-search-index.sh 経由 (使い捨てクラスタを用意する)。
 * 本スクリプト単体では動作しない。接続先は BENCH_DATABASE_URL のみを読み、
 * localhost の bench ポートでなければ即座に終了する (本番 DB 誤爆の防止)。
 * DATABASE_URL は意図的に一切参照しない。
 *
 * 接続様式は既存スクリプトと同一 (Node postgres / prepare:false / 単一接続)。
 * アプリ本体も prepare:false (lib/db/client.ts) なので毎回 custom plan になる点を揃える。
 * 接続文字列の値はログに出力しない。
 */
import postgres from "postgres";

// ---------------------------------------------------------------------------
// 接続先ガード: 本番 DB への誤爆を構造的に防ぐ
// ---------------------------------------------------------------------------
const url = process.env.BENCH_DATABASE_URL;
if (!url) {
  console.error("ERROR: BENCH_DATABASE_URL is not set. bash scripts/bench-area-search-index.sh から実行してください。");
  process.exit(1);
}

const expectedPort = process.env.BENCH_PG_PORT ?? "55432";
let parsed;
try {
  parsed = new URL(url);
} catch {
  console.error("ERROR: BENCH_DATABASE_URL の形式が不正です。");
  process.exit(1);
}
if (!["127.0.0.1", "localhost"].includes(parsed.hostname) || parsed.port !== expectedPort) {
  // 接続文字列そのものは出力しない (規約)。判定に必要な最小限だけ示す。
  console.error(
    `ERROR: BENCH_DATABASE_URL must point at the throwaway local cluster ` +
      `(expected host 127.0.0.1/localhost and port ${expectedPort}, got host ${parsed.hostname} port ${parsed.port || "(none)"}).`,
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 引数
// ---------------------------------------------------------------------------
function arg(name, fallback) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

const ROW_TIERS = arg("rows", "1000,10000,100000").split(",").map((n) => Number(n.trim()));
const NULL_RATES = arg("null-rates", "0.9,0.5,0.1").split(",").map((n) => Number(n.trim()));
const SEED = Number(arg("seed", "0.42"));
const RUNS = Number(arg("runs", "20"));

/**
 * 都市中心 20 点。合成データの 80% をこれらの周辺 (±0.05° ≒ 5km) に集める。
 * 一様分布のみだと bbox 選択率が非現実的に低く出て index を過大評価し、
 * 都市集中のみだと逆に過小評価するため、混合が公正。
 */
const CITY_LAT = [
  35.6812, 35.6465, 35.4437, 34.7025, 35.1709, 33.5904, 43.0618, 38.2682,
  35.0116, 34.6901, 34.3853, 33.8834, 36.5613, 34.9756, 35.1815, 36.0652,
  31.5966, 39.7036, 33.5597, 26.2124,
];
const CITY_LNG = [
  139.7671, 139.71, 139.638, 135.4959, 136.8815, 130.4017, 141.3545, 140.8694,
  135.7681, 135.1955, 132.4553, 130.8751, 139.8836, 138.3828, 136.9066, 136.2216,
  130.5571, 141.1527, 133.5311, 127.6809,
];

const IN_LIST_SIZE = 20; // Places 1 ページの最大件数

// ---------------------------------------------------------------------------
// index 候補
// ---------------------------------------------------------------------------
const CANDIDATES = [
  { id: "C0", label: "index なし (baseline)", ddl: [] },
  { id: "C1", label: "(lat,lng) 複合", ddl: ['create index stores_lat_lng_idx on stores using btree (lat, lng)'] },
  {
    id: "C2",
    label: "(lat)+(lng) 個別",
    ddl: [
      'create index stores_lat_idx on stores using btree (lat)',
      'create index stores_lng_idx on stores using btree (lng)',
    ],
  },
  {
    id: "C3",
    label: "(lat,lng) 部分",
    ddl: ['create index stores_lat_lng_idx on stores using btree (lat, lng) where lat is not null and lng is not null'],
  },
  {
    id: "C4",
    label: "(lat)+(lng) 部分個別",
    ddl: [
      'create index stores_lat_idx on stores using btree (lat) where lat is not null',
      'create index stores_lng_idx on stores using btree (lng) where lng is not null',
    ],
  },
];

const INDEX_NAMES = ["stores_lat_lng_idx", "stores_lat_idx", "stores_lng_idx"];

const sql = postgres(url, {
  prepare: false,
  max: 1,
  idle_timeout: 5,
  connect_timeout: 10,
  // truncate cascade 等の NOTICE は結果表を埋めるだけなので抑制する
  onnotice: () => {},
});

// ---------------------------------------------------------------------------
// 合成データ生成
// ---------------------------------------------------------------------------
/**
 * lat/lng が入る行は Places 経由なので google_place_id も入る。独立に乱数生成しては
 * ならない (OR の 2 つの腕がほぼ同じ行集合を指すという実態が BitmapOr のコストに効く)。
 * さらに「Places で見つけたが座標欠損」を模す 2% だけ place_id 非 NULL / lat NULL にする。
 *
 * 列幅は本番の pg_stats 実測値に合わせる (memo 216B が支配的、basic_info は実質空)。
 */
/**
 * 行ごとの擬似乱数 [0,1)。
 *
 * random() を相関のない LATERAL 副問い合わせで使うと、Postgres がそれを 1 度だけ評価して
 * 全行で同じ値を使い回すため、NULL 率などの指定が効かなくなる (実際に踏んだ)。
 * salt と行番号 i から md5 で導出することで、行ごとに評価されることと
 * seed 指定による完全な再現性の双方を保証する。
 * 7 hex (28bit) に抑えているのは bit(28)::int が常に非負になるようにするため。
 */
function rnd(salt) {
  return `((('x' || substr(md5('${salt}:${SEED}:' || i::text), 1, 7))::bit(28)::int) / 268435456.0)`;
}

async function populate(rows, nullRate) {
  await sql.unsafe("truncate table stores cascade");
  await sql.unsafe(
    `
    insert into stores (
      id, name, prefecture, city, address, genre, priority, stage, channel,
      has_contact_form, map_url, site_url, instagram_url, phone, target_service,
      review_count, review_avg, memo, operator_type, operator_name,
      lat, lng, google_place_id, basic_info, created_at, updated_at
    )
    select
      'store_' || lpad(i::text, 9, '0'),
      '合成店舗' || i,
      '東京都',
      '世田谷区北沢' || (i % 900),
      '1-' || (i % 40) || '-' || (i % 20) || ' 合成ビル' || (i % 12) || 'F',
      case i % 6 when 0 then '居酒屋' when 1 then 'カフェ' when 2 then 'ラーメン'
                 when 3 then 'イタリアン' when 4 then '焼肉' else 'バー' end,
      case i % 3 when 0 then '高' when 1 then '中' else '低' end,
      case i % 4 when 0 then '未調査' when 1 then '調査済み' when 2 then 'DeepResearch済み' else '架電済み' end,
      case i % 4 when 0 then 'DM推奨' when 1 then 'テレアポ推奨' when 2 then '要確認' else '未判定' end,
      case i % 3 when 0 then '有' when 1 then '無' else '未確認' end,
      'https://maps.google.com/?cid=' || i,
      'https://example' || (i % 5000) || '.co.jp',
      'https://instagram.com/s' || i,
      '03-' || lpad((i % 9999)::text, 4, '0') || '-' || lpad((i % 8888)::text, 4, '0'),
      'LINE',
      (rnd.r_rev * 800)::int,
      (3 + rnd.r_avg * 2)::real,
      -- 本番 pg_stats の memo avg_width=216B を再現する
      '営業メモ: ' || repeat('架電時の反応と次回訪問の所感を記録。', 5) || i,
      case i % 3 when 0 then '個人店' when 1 then '複数店舗運営' else '未設定' end,
      case when i % 7 = 0 then '株式会社合成' || i else '' end,
      case when rnd.is_area and not rnd.coord_missing then
        case when rnd.use_city
             then (p.clat)[rnd.city_i] + (rnd.r_lat - 0.5) * 0.1
             else 24 + rnd.r_lat * 22 end
      end::real,
      case when rnd.is_area and not rnd.coord_missing then
        case when rnd.use_city
             then (p.clng)[rnd.city_i] + (rnd.r_lng - 0.5) * 0.1
             else 123 + rnd.r_lng * 23 end
      end::real,
      case when rnd.is_area then 'ChIJ' || md5(i::text) end,
      '{}'::jsonb,
      to_char(date '2024-01-01' + ((i % 730) || ' days')::interval, 'YYYY-MM-DD'),
      to_char(date '2024-01-01' + ((i % 730) || ' days')::interval, 'YYYY-MM-DD')
    from (select $2::float8[] as clat, $3::float8[] as clng) p,
         generate_series(1, $1::int) i,
         lateral (
           select
             ${rnd("area")} >= $4::float8                as is_area,
             ${rnd("missing")} < 0.02                    as coord_missing,
             ${rnd("geo")} < 0.8                         as use_city,
             1 + floor(${rnd("city")} * $5::int)::int    as city_i,
             ${rnd("lat")} as r_lat, ${rnd("lng")} as r_lng,
             ${rnd("rev")} as r_rev, ${rnd("avg")} as r_avg
         ) rnd
    `,
    [rows, CITY_LAT, CITY_LNG, nullRate, CITY_LAT.length],
  );
  await sql.unsafe("vacuum analyze stores");
}

// ---------------------------------------------------------------------------
// クエリ形状
// ---------------------------------------------------------------------------
/** bbox の広さ: 半径 r[m] の探索なら概ね 2r/111000 + 2*BBOX_MARGIN_DEGREES 度 */
function bboxFor(centerLat, centerLng, radiusMeters) {
  const half = radiusMeters / 111000 + 0.001;
  return [centerLat - half, centerLat + half, centerLng - half, centerLng + half];
}

const IN_PLACEHOLDERS = Array.from({ length: IN_LIST_SIZE }, (_, i) => `$${i + 1}`).join(", ");
const B = (o) => [`$${o + 1}`, `$${o + 2}`, `$${o + 3}`, `$${o + 4}`];

/** drizzle が生成する形に合わせる (inArray → IN リスト、bbox は gte/lte の AND、ORDER BY created_at DESC) */
const QUERIES = {
  Q1: {
    label: "bbox のみ + ORDER BY",
    sql: `select * from stores where (lat >= ${B(0)[0]} and lat <= ${B(0)[1]} and lng >= ${B(0)[2]} and lng <= ${B(0)[3]}) order by created_at desc`,
    params: (ids, bbox) => bbox,
  },
  Q2: {
    label: "place_id IN のみ + ORDER BY",
    sql: `select * from stores where google_place_id in (${IN_PLACEHOLDERS}) order by created_at desc`,
    params: (ids) => ids,
  },
  Q3: {
    label: "IN OR bbox + ORDER BY (本番の実クエリ形状)",
    sql: `select * from stores where google_place_id in (${IN_PLACEHOLDERS}) or (lat >= $${IN_LIST_SIZE + 1} and lat <= $${IN_LIST_SIZE + 2} and lng >= $${IN_LIST_SIZE + 3} and lng <= $${IN_LIST_SIZE + 4}) order by created_at desc`,
    params: (ids, bbox) => [...ids, ...bbox],
  },
  Q4: {
    label: "Q3 から ORDER BY を除去",
    sql: `select * from stores where google_place_id in (${IN_PLACEHOLDERS}) or (lat >= $${IN_LIST_SIZE + 1} and lat <= $${IN_LIST_SIZE + 2} and lng >= $${IN_LIST_SIZE + 3} and lng <= $${IN_LIST_SIZE + 4})`,
    params: (ids, bbox) => [...ids, ...bbox],
  },
  Q5: {
    label: "Q3 の projection を縮小",
    sql: `select id, name, lat, lng, google_place_id from stores where google_place_id in (${IN_PLACEHOLDERS}) or (lat >= $${IN_LIST_SIZE + 1} and lat <= $${IN_LIST_SIZE + 2} and lng >= $${IN_LIST_SIZE + 3} and lng <= $${IN_LIST_SIZE + 4}) order by created_at desc`,
    params: (ids, bbox) => [...ids, ...bbox],
  },
};

// ---------------------------------------------------------------------------
// 計測
// ---------------------------------------------------------------------------
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
const pct = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(s.length * p))]; };

/**
 * 主判断値は EXPLAIN を付けない素のクエリの wall-clock。
 * EXPLAIN ANALYZE のタプル単位タイマは Seq Scan を不当に不利に見せる (= index を過大評価する) ため。
 */
async function measure(query, params) {
  await sql.unsafe(query, params); // warmup
  const times = [];
  for (let i = 0; i < RUNS; i++) {
    const t0 = process.hrtime.bigint();
    await sql.unsafe(query, params);
    times.push(Number(process.hrtime.bigint() - t0) / 1e6);
  }
  return { median: median(times), p95: pct(times, 0.95) };
}

async function explain(query, params) {
  const rows = await sql.unsafe(`explain (analyze, buffers, format json) ${query}`, params);
  const plan = rows[0]["QUERY PLAN"][0];
  return {
    planningTime: plan["Planning Time"],
    executionTime: plan["Execution Time"],
    text: describePlan(plan.Plan),
    raw: plan.Plan,
  };
}

/** plan ツリーからノード種別の連なりと Index Cond の有無を要約する */
function describePlan(node, depth = 0) {
  const parts = [];
  const name = node["Node Type"] + (node["Index Name"] ? `(${node["Index Name"]})` : "");
  parts.push(name);
  for (const child of node.Plans ?? []) parts.push(describePlan(child, depth + 1));
  return depth === 0 ? parts.join(" > ") : parts.join(" > ");
}

function findIndexCond(node, acc = []) {
  if (node["Index Cond"]) acc.push(node["Index Cond"]);
  for (const child of node.Plans ?? []) findIndexCond(child, acc);
  return acc;
}

async function dropAllTestIndexes() {
  for (const n of INDEX_NAMES) await sql.unsafe(`drop index if exists ${n}`);
}

async function applyCandidate(c) {
  await dropAllTestIndexes();
  for (const ddl of c.ddl) await sql.unsafe(ddl);
  await sql.unsafe("analyze stores");
}

async function indexSizeBytes() {
  const rows = await sql.unsafe(
    `select coalesce(sum(pg_relation_size(indexrelid)), 0)::bigint as bytes
     from pg_stat_user_indexes where relname = 'stores' and indexrelname = any($1)`,
    [INDEX_NAMES],
  );
  return Number(rows[0].bytes);
}

const kb = (b) => `${(b / 1024).toFixed(0)}kB`;
const ms = (n) => n.toFixed(3).padStart(9);

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------
try {
  console.log("=".repeat(100));
  console.log("エリア検索 bbox index ベンチマーク (Issue #162)");
  const [v] = await sql.unsafe("select version() as v");
  console.log(v.v.split(",")[0]);
  console.log(`seed=${SEED} runs=${RUNS} rows=[${ROW_TIERS}] nullRates=[${NULL_RATES}]`);
  console.log("=".repeat(100));

  const results = [];

  for (const rows of ROW_TIERS) {
    for (const nullRate of NULL_RATES) {
      await populate(rows, nullRate);

      const [stat] = await sql.unsafe(`
        select count(*)::int as total,
               count(lat)::int as with_lat,
               count(google_place_id)::int as with_pid,
               round(avg(pg_column_size(t.*)))::int as avg_row_bytes,
               pg_size_pretty(pg_relation_size('stores')) as heap
        from stores t`);
      const [w] = await sql.unsafe(`select sum(avg_width)::int as w from pg_stats where tablename='stores'`);

      // 実データの place_id を 20 件、都心 bbox を採用 (index にとって最悪ケース = 選択率が高い側)
      const idRows = await sql.unsafe(
        `select google_place_id from stores where google_place_id is not null limit ${IN_LIST_SIZE}`,
      );
      const ids = idRows.map((r) => r.google_place_id);
      while (ids.length < IN_LIST_SIZE) ids.push("ChIJ_absent_" + ids.length);
      const bbox = bboxFor(CITY_LAT[0], CITY_LNG[0], 1000);

      console.log("");
      console.log("-".repeat(100));
      console.log(
        `rows=${stat.total}  lat非NULL=${stat.with_lat} (${((stat.with_lat / stat.total) * 100).toFixed(1)}%)  ` +
          `place_id非NULL=${stat.with_pid}  heap=${stat.heap}  planner幅=${w.w}B (本番実測 552B / EXPLAIN width=680)`,
      );
      console.log("-".repeat(100));
      console.log(
        "cand  index                     idxサイズ   Q3中央値   Q3 p95   Q3計画   Q1中央値   1session(10x)  plan",
      );

      let baseline = null;
      for (const c of CANDIDATES) {
        await applyCandidate(c);
        const size = await indexSizeBytes();

        const q3 = await measure(QUERIES.Q3.sql, QUERIES.Q3.params(ids, bbox));
        const q1 = await measure(QUERIES.Q1.sql, QUERIES.Q1.params(ids, bbox));
        const e3 = await explain(QUERIES.Q3.sql, QUERIES.Q3.params(ids, bbox));

        // 1 セッション換算: prepare:false かつ 1 検索で 10 回以上呼ばれるため planning が 10 倍で効く
        const session = (e3.planningTime + e3.executionTime) * 10;
        if (c.id === "C0") baseline = { q3: q3.median, session };

        const delta = baseline ? ((q3.median - baseline.q3) / baseline.q3) * 100 : 0;
        const deltaStr = c.id === "C0" ? "   —  " : `${delta >= 0 ? "+" : ""}${delta.toFixed(1)}%`;

        console.log(
          `${c.id}    ${c.label.padEnd(24)} ${kb(size).padStart(8)}  ${ms(q3.median)} ${ms(q3.p95)} ` +
            `${ms(e3.planningTime)} ${ms(q1.median)}  ${ms(session)} ${deltaStr.padStart(8)}  ${e3.text.slice(0, 60)}`,
        );

        results.push({
          rows: stat.total, nullRate, withLat: stat.with_lat, candidate: c.id, label: c.label,
          indexBytes: size, q3Median: q3.median, q3P95: q3.p95, q1Median: q1.median,
          planningTime: e3.planningTime, executionTime: e3.executionTime, sessionMs: session,
          deltaPct: c.id === "C0" ? 0 : delta, plan: e3.text, indexConds: findIndexCond(e3.raw),
        });
      }
    }
  }

  // -------------------------------------------------------------------------
  // real × double precision の cross-type 検証
  // -------------------------------------------------------------------------
  console.log("");
  console.log("=".repeat(100));
  console.log("real (float4) 列 × double precision パラメータの cross-type 検証");
  console.log("bbox 境界が Index Cond に現れれば index で範囲制限できている。Filter に落ちていれば不可。");
  console.log("=".repeat(100));

  await populate(100000, 0.5);
  const bbox = bboxFor(CITY_LAT[0], CITY_LNG[0], 1000);
  for (const c of CANDIDATES.filter((x) => x.ddl.length > 0)) {
    await applyCandidate(c);
    // (i) バインドパラメータ
    const bound = await explain(
      `select * from stores where lat >= $1 and lat <= $2 and lng >= $3 and lng <= $4`, bbox);
    // (ii) SQL リテラル直書き
    const literal = await explain(
      `select * from stores where lat >= ${bbox[0]} and lat <= ${bbox[1]} and lng >= ${bbox[2]} and lng <= ${bbox[3]}`, []);
    const condB = findIndexCond(bound.raw);
    const condL = findIndexCond(literal.raw);
    console.log(`${c.id} ${c.label}`);
    console.log(`   bind   : ${condB.length ? "Index Cond → " + condB.join(" / ") : "Index Cond なし (" + bound.text + ")"}`);
    console.log(`   literal: ${condL.length ? "Index Cond → " + condL.join(" / ") : "Index Cond なし (" + literal.text + ")"}`);
  }

  // -------------------------------------------------------------------------
  // enable_seqscan=off 対照: クロスオーバー点の推定
  // -------------------------------------------------------------------------
  console.log("");
  console.log("=".repeat(100));
  console.log("enable_seqscan=off 対照 (planner が選ばなくても index パスの推定コストを見る)");
  console.log("=".repeat(100));
  console.log("rows      nullRate  C0(seq) cost   C1(idx強制) cost   plannerの選択");

  for (const rows of ROW_TIERS) {
    await populate(rows, 0.5);
    await applyCandidate(CANDIDATES[0]);
    const seqCost = (await sql.unsafe(
      `explain (format json) ${QUERIES.Q3.sql}`, QUERIES.Q3.params(
        (await sql.unsafe(`select google_place_id from stores where google_place_id is not null limit ${IN_LIST_SIZE}`))
          .map((r) => r.google_place_id), bboxFor(CITY_LAT[0], CITY_LNG[0], 1000))
    ))[0]["QUERY PLAN"][0].Plan["Total Cost"];

    await applyCandidate(CANDIDATES[1]);
    const ids2 = (await sql.unsafe(`select google_place_id from stores where google_place_id is not null limit ${IN_LIST_SIZE}`)).map((r) => r.google_place_id);
    while (ids2.length < IN_LIST_SIZE) ids2.push("ChIJ_absent_" + ids2.length);
    const bb = bboxFor(CITY_LAT[0], CITY_LNG[0], 1000);
    const natural = (await sql.unsafe(`explain (format json) ${QUERIES.Q3.sql}`, QUERIES.Q3.params(ids2, bb)))[0]["QUERY PLAN"][0].Plan;
    await sql.unsafe("set enable_seqscan = off");
    const forced = (await sql.unsafe(`explain (format json) ${QUERIES.Q3.sql}`, QUERIES.Q3.params(ids2, bb)))[0]["QUERY PLAN"][0].Plan;
    await sql.unsafe("set enable_seqscan = on");

    console.log(
      `${String(rows).padStart(8)}  0.5       ${seqCost.toFixed(2).padStart(12)}   ${forced["Total Cost"].toFixed(2).padStart(14)}   ` +
        `${describePlan(natural).slice(0, 50)}`,
    );
  }

  console.log("");
  console.log("=".repeat(100));
  console.log("JSON 結果 (docs へ転記用)");
  console.log("=".repeat(100));
  console.log(JSON.stringify(results, null, 1));

  await sql.end({ timeout: 5 });
} catch (err) {
  console.error("BENCH ERROR:", err instanceof Error ? err.message : String(err));
  await sql.end({ timeout: 5 }).catch(() => {});
  process.exit(1);
}
