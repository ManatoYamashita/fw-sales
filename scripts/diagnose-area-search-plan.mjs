/**
 * エリア検索 bbox 候補取得の実行計画を診断する読み取り専用スクリプト (Issue #162)。
 *
 * lib/db/store-repository.ts の findAreaSearchCandidates が発行するクエリ形状
 * (google_place_id IN (...) OR bbox 範囲) について、対象 DB の行数・NULL 率・
 * 既存 index・planner 設定・実行計画を出力する。
 *
 * index 追加の要否は stores の行数と lat/lng の NULL 率に強く依存するため、
 * 本番にデータが蓄積した後に本スクリプトを再実行して再判定する。
 * 判定基準とベンチ結果は docs/area-search-index-benchmark.md を参照。
 *
 * 本スクリプトが単独で答えられるのは「今どうなっているか」までである。「index を入れたら
 * どうなるか」は、実 index を張らない限り原理的に測れない (DDL なので本番では行わない)。
 * そのため次の 2 つを併せて出力する。
 *   - HypoPG が既に有効なら、仮想 index による推定コストの比較 (拡張の導入は行わない)
 *   - 実分布をベンチのパラメータへ翻訳した「再評価コマンド」。使い捨てクラスタで
 *     C0/C1/C3 の実測差を採るための入口であり、最終判断はそちらの実測で行う
 *
 * SELECT と EXPLAIN のみを実行し、データ・スキーマへの書き込みは一切行わない。
 * EXPLAIN ANALYZE は実際にクエリを実行するため read only トランザクション内で発行し、
 * statement_timeout を張って対象 DB を長時間占有しないようにする。
 *
 * 使い方:
 *   pnpm db:diagnose-area-search
 *   pnpm db:diagnose-area-search --bbox=35.65,139.68,35.69,139.72   (minLat,minLng,maxLat,maxLng)
 *   pnpm db:diagnose-area-search --json                             (機械可読出力)
 *
 * 接続様式は supabase-keepalive.yml と同一 (Node postgres / prepare:false / 単一接続)。
 * psql (libpq) は DATABASE_URL 中の特殊文字を host と誤読するため使わない。
 * 接続文字列の値はログに出力しない。
 */
import postgres from "postgres";

/** Places 1 ページの最大件数。IN リストの長さを実運用に合わせる。 */
const IN_LIST_SIZE = 20;

/** 実データが無い場合のフォールバック bbox (東京・半径 1km 相当)。 */
const FALLBACK_BBOX = { minLat: 35.6712, minLng: 139.7571, maxLat: 35.6912, maxLng: 139.7771 };

/** ベンチクラスタと本番の差異検出に使う planner 設定。 */
const PLANNER_SETTINGS = [
  "shared_buffers", "work_mem", "maintenance_work_mem", "effective_cache_size",
  "random_page_cost", "seq_page_cost", "cpu_tuple_cost", "cpu_index_tuple_cost",
  "cpu_operator_cost", "effective_io_concurrency", "max_parallel_workers_per_gather",
  "min_parallel_table_scan_size", "jit", "default_statistics_target",
];

function parseArgs(argv) {
  const out = { json: false };
  for (const arg of argv) {
    if (arg === "--json") { out.json = true; continue; }
    const m = arg.match(/^--(bbox)=(.+)$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));

let cliBbox = null;
if (args.bbox) {
  const nums = args.bbox.split(",").map((s) => Number(s.trim()));
  if (nums.length !== 4 || nums.some((n) => !Number.isFinite(n))) {
    console.error("ERROR: --bbox=minLat,minLng,maxLat,maxLng の形式で 4 つの数値を指定してください。");
    process.exit(1);
  }
  cliBbox = { minLat: nums[0], minLng: nums[1], maxLat: nums[2], maxLng: nums[3] };
}

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("ERROR: DATABASE_URL is not set.");
  process.exit(1);
}

const sql = postgres(url, {
  prepare: false,
  max: 1,
  idle_timeout: 5,
  connect_timeout: 10,
  onnotice: () => {},
});

/** plan ツリーをノード種別の連なりに要約する */
function describePlan(node) {
  const name = node["Node Type"] + (node["Index Name"] ? `(${node["Index Name"]})` : "");
  const children = (node.Plans ?? []).map(describePlan);
  return children.length ? `${name} > ${children.join(" > ")}` : name;
}

function collect(node, key, acc = []) {
  if (node[key] !== undefined) acc.push(node[key]);
  for (const child of node.Plans ?? []) collect(child, key, acc);
  return acc;
}

const out = {};

try {
  const [version] = await sql`select version() as v`;
  out.version = version.v.split(",")[0];

  // -------------------------------------------------------------------------
  // 1. 行数と NULL 率
  // -------------------------------------------------------------------------
  const [counts] = await sql`
    select count(*)::int                                              as total,
           count(lat)::int                                            as with_lat,
           count(lng)::int                                            as with_lng,
           count(google_place_id)::int                                as with_place_id,
           count(*) filter (where lat is not null and lng is not null)::int as with_coords
    from stores`;
  out.counts = counts;

  // -------------------------------------------------------------------------
  // 2. サイズと統計の鮮度
  // -------------------------------------------------------------------------
  const [size] = await sql`
    select pg_size_pretty(pg_relation_size('stores'))       as heap,
           pg_size_pretty(pg_total_relation_size('stores')) as total,
           (select round(avg(pg_column_size(t.*)))::int from stores t) as avg_row_bytes,
           (select sum(avg_width)::int from pg_stats
             where schemaname = 'public' and tablename = 'stores')     as planner_width`;
  out.size = size;

  const [freshness] = await sql`
    select n_live_tup::int as n_live_tup, last_analyze, last_autoanalyze, last_vacuum, last_autovacuum
    from pg_stat_user_tables where relname = 'stores'`;
  out.freshness = freshness ?? null;

  // -------------------------------------------------------------------------
  // 3. 既存 index
  // -------------------------------------------------------------------------
  const indexes = await sql`
    select i.indexname,
           i.indexdef,
           pg_size_pretty(pg_relation_size((quote_ident(i.schemaname) || '.' || quote_ident(i.indexname))::regclass)) as size
    from pg_indexes i
    where i.schemaname = 'public' and i.tablename = 'stores'
    order by i.indexname`;
  out.indexes = indexes.map((r) => ({ name: r.indexname, def: r.indexdef, size: r.size }));

  // -------------------------------------------------------------------------
  // 4. planner 設定
  // -------------------------------------------------------------------------
  const settings = await sql`
    select name, setting, unit from pg_settings where name = any(${PLANNER_SETTINGS}) order by name`;
  out.plannerSettings = settings.map((r) => ({ name: r.name, setting: r.setting, unit: r.unit }));

  // -------------------------------------------------------------------------
  // 5. 代表的なパラメータの決定
  // -------------------------------------------------------------------------
  const idRows = await sql`
    select google_place_id from stores where google_place_id is not null limit ${IN_LIST_SIZE}`;
  const ids = idRows.map((r) => r.google_place_id);

  let bbox = cliBbox;
  let bboxSource = cliBbox ? "--bbox 引数" : null;
  if (!bbox) {
    const [sample] = await sql`
      select lat, lng from stores where lat is not null and lng is not null limit 1`;
    if (sample) {
      bbox = {
        minLat: sample.lat - 0.02, maxLat: sample.lat + 0.02,
        minLng: sample.lng - 0.02, maxLng: sample.lng + 0.02,
      };
      bboxSource = "実データからサンプリング";
    } else {
      bbox = FALLBACK_BBOX;
      bboxSource = "フォールバック (実データに座標が無い)";
    }
  }
  out.bbox = bbox;
  out.bboxSource = bboxSource;

  // 実データが代表性を欠く場合は、出た plan を信用してはならない旨を明示する。
  const representative = counts.with_coords > 0 && ids.length > 0;
  out.representative = representative;

  const paddedIds = [...ids];
  while (paddedIds.length < IN_LIST_SIZE) paddedIds.push(`ChIJ_absent_${paddedIds.length}`);

  // -------------------------------------------------------------------------
  // 6. EXPLAIN (read only トランザクション内)
  // -------------------------------------------------------------------------
  const inPlaceholders = Array.from({ length: IN_LIST_SIZE }, (_, i) => `$${i + 1}`).join(", ");
  const b = IN_LIST_SIZE;
  const QUERIES = [
    {
      id: "Q1", label: "bbox のみ + ORDER BY",
      sql: `select * from stores where (lat >= $1 and lat <= $2 and lng >= $3 and lng <= $4) order by created_at desc`,
      params: [bbox.minLat, bbox.maxLat, bbox.minLng, bbox.maxLng],
    },
    {
      id: "Q2", label: "place_id IN のみ + ORDER BY",
      sql: `select * from stores where google_place_id in (${inPlaceholders}) order by created_at desc`,
      params: paddedIds,
    },
    {
      id: "Q3", label: "IN OR bbox + ORDER BY (本番の実クエリ形状)",
      sql: `select * from stores where google_place_id in (${inPlaceholders}) or (lat >= $${b + 1} and lat <= $${b + 2} and lng >= $${b + 3} and lng <= $${b + 4}) order by created_at desc`,
      params: [...paddedIds, bbox.minLat, bbox.maxLat, bbox.minLng, bbox.maxLng],
    },
  ];

  out.plans = [];
  await sql.begin(async (tx) => {
    await tx.unsafe("set transaction read only");
    await tx.unsafe("set local statement_timeout = '10s'");
    for (const q of QUERIES) {
      const rows = await tx.unsafe(`explain (analyze, buffers, format json) ${q.sql}`, q.params);
      const plan = rows[0]["QUERY PLAN"][0];
      out.plans.push({
        id: q.id,
        label: q.label,
        planningTime: plan["Planning Time"],
        executionTime: plan["Execution Time"],
        shape: describePlan(plan.Plan),
        indexConds: collect(plan.Plan, "Index Cond"),
        rowsRemovedByFilter: collect(plan.Plan, "Rows Removed by Filter"),
        actualRows: plan.Plan["Actual Rows"],
      });
    }
  });

  // -------------------------------------------------------------------------
  // 7. HypoPG による候補 index の見積比較 (拡張が既に有効な場合のみ)
  // -------------------------------------------------------------------------
  // 本スクリプトだけでは「index を入れたらどうなるか」は分からない。実 index を張るのは
  // DDL なので本番では行えないが、HypoPG があれば仮想 index の推定コストを比較できる。
  // 仮想 index はバックエンドのメモリ上にしか存在せず、セッション終了で自動的に消える。
  //
  // CREATE EXTENSION は DDL なのでここでは絶対に発行しない。未導入なら案内だけ出す。
  const [hypo] = await sql`select 1 as ok from pg_extension where extname = 'hypopg'`;
  out.hypopgAvailable = Boolean(hypo);
  out.hypopg = null;

  if (hypo) {
    const HYPO_CANDIDATES = [
      { id: "C1", label: "(lat,lng) 複合", ddl: "create index on stores (lat, lng)" },
      {
        id: "C3", label: "(lat,lng) 部分",
        ddl: "create index on stores (lat, lng) where lat is not null and lng is not null",
      },
    ];
    try {
      const q3 = QUERIES[2];
      const totalCost = async (tx) => {
        const rows = await tx.unsafe(`explain (format json) ${q3.sql}`, q3.params);
        const plan = rows[0]["QUERY PLAN"][0].Plan;
        return { cost: plan["Total Cost"], shape: describePlan(plan) };
      };

      await sql.begin(async (tx) => {
        await tx.unsafe("set transaction read only");
        await tx.unsafe("set local statement_timeout = '10s'");
        await tx.unsafe("select hypopg_reset()");

        const base = await totalCost(tx);
        const candidates = [];
        for (const c of HYPO_CANDIDATES) {
          await tx.unsafe("select hypopg_reset()");
          const [created] = await tx.unsafe("select indexname from hypopg_create_index($1)", [c.ddl]);
          const got = await totalCost(tx);
          candidates.push({
            id: c.id, label: c.label, indexName: created?.indexname ?? null,
            cost: got.cost, shape: got.shape,
            deltaPct: base.cost ? ((got.cost - base.cost) / base.cost) * 100 : 0,
            used: got.shape.includes("<") || /index/i.test(got.shape),
          });
        }
        await tx.unsafe("select hypopg_reset()");
        out.hypopg = { baseline: base, candidates };
      });
    } catch (err) {
      // 失敗しても診断本体は成立するので握りつぶして記録だけ残す。
      out.hypopg = { error: err instanceof Error ? err.message : String(err) };
    }
  }

  // -------------------------------------------------------------------------
  // 8. 再評価コマンドの生成
  // -------------------------------------------------------------------------
  // 実分布 (行数・座標 NULL 率) をベンチのパラメータに翻訳する。
  // ベンチの --null-rates は「座標を持たない行の割合」なので with_coords の補数になる。
  const observedNullRate = counts.total > 0 ? 1 - counts.with_coords / counts.total : 1;
  const tier = (n) => {
    const tiers = [100, 300, 1000, 10000, 20000, 50000, 100000];
    return tiers.find((t) => t >= n) ?? 100000;
  };
  out.reevaluation = {
    observedNullRate: Number(observedNullRate.toFixed(3)),
    suggestedRows: tier(counts.total),
    command:
      `bash scripts/bench-area-search-index.sh --rows=${tier(counts.total)} ` +
      `--null-rates=${observedNullRate.toFixed(2)} --hit-rates=0.25 --runs=50`,
  };

  // -------------------------------------------------------------------------
  // 出力
  // -------------------------------------------------------------------------
  if (args.json) {
    console.log(JSON.stringify(out, null, 2));
  } else {
    const pctOf = (n) => (counts.total ? ((n / counts.total) * 100).toFixed(1) : "0.0");
    console.log("=".repeat(88));
    console.log("エリア検索 bbox 候補取得の実行計画診断 (Issue #162)");
    console.log(out.version);
    console.log("=".repeat(88));

    console.log("\n[ stores の規模と NULL 率 ]");
    console.log(`  行数                    : ${counts.total}`);
    console.log(`  lat/lng とも非 NULL     : ${counts.with_coords} (${pctOf(counts.with_coords)}%)`);
    console.log(`  google_place_id 非 NULL : ${counts.with_place_id} (${pctOf(counts.with_place_id)}%)`);
    console.log(`  heap / total サイズ     : ${size.heap} / ${size.total}`);
    console.log(`  平均行バイト / planner 幅: ${size.avg_row_bytes ?? "n/a"}B / ${size.planner_width ?? "n/a"}B`);
    if (freshness) {
      console.log(`  統計の鮮度              : last_analyze=${freshness.last_analyze ?? "なし"} last_autoanalyze=${freshness.last_autoanalyze ?? "なし"}`);
    }

    console.log("\n[ 既存 index ]");
    for (const i of out.indexes) console.log(`  ${i.size.padStart(8)}  ${i.def}`);

    console.log("\n[ planner 設定 (ベンチクラスタを本番に揃える際の入力元) ]");
    for (const s of out.plannerSettings) {
      console.log(`  ${s.name.padEnd(32)} = ${s.setting}${s.unit ? " " + s.unit : ""}`);
    }

    console.log(`\n[ 実行計画 ]  bbox=${bboxSource}: ` +
      `lat ${bbox.minLat.toFixed(4)}..${bbox.maxLat.toFixed(4)} / lng ${bbox.minLng.toFixed(4)}..${bbox.maxLng.toFixed(4)}`);
    if (!representative) {
      console.log("");
      console.log("  WARN: no representative data — this plan is not meaningful.");
      console.log("        座標を持つ店舗または google_place_id を持つ店舗が存在しないため、");
      console.log("        以下の実行計画は実運用の負荷を表していません。index 要否の判断材料に使わないでください。");
    }
    for (const p of out.plans) {
      console.log(`\n  ${p.id} ${p.label}`);
      console.log(`    plan       : ${p.shape}`);
      console.log(`    planning   : ${p.planningTime.toFixed(3)} ms / execution: ${p.executionTime.toFixed(3)} ms`);
      console.log(`    actual rows: ${p.actualRows}` +
        (p.rowsRemovedByFilter.length ? ` / rows removed by filter: ${p.rowsRemovedByFilter.join(", ")}` : ""));
      if (p.indexConds.length) console.log(`    index cond : ${p.indexConds.join(" / ")}`);
    }

    console.log("\n[ 候補 index の見積比較 (HypoPG) ]");
    if (!out.hypopgAvailable) {
      console.log("  HypoPG 拡張が未導入のため、仮想 index による比較は行いませんでした。");
      console.log("  この診断だけでは「index を入れたらどうなるか」は分かりません (現状の plan しか見えない)。");
      console.log("  比較したい場合は次のいずれか:");
      console.log("    a) 下の再評価コマンドで使い捨てクラスタの実測差を採る (推奨・本番に触れない)");
      console.log("    b) 本番で HypoPG を有効化する (CREATE EXTENSION は DDL。要承認)");
    } else if (out.hypopg?.error) {
      console.log(`  HypoPG は導入済みですが比較に失敗しました: ${out.hypopg.error}`);
    } else if (out.hypopg) {
      console.log(`  ${"C0 index なし".padEnd(20)} 推定コスト ${out.hypopg.baseline.cost.toFixed(2).padStart(10)}`);
      for (const c of out.hypopg.candidates) {
        const sign = c.deltaPct >= 0 ? "+" : "";
        console.log(
          `  ${(c.id + " " + c.label).padEnd(20)} 推定コスト ${c.cost.toFixed(2).padStart(10)}` +
            `  (${sign}${c.deltaPct.toFixed(1)}%)  ${c.shape.slice(0, 44)}`,
        );
      }
      console.log("  注: 推定コストであり実行時間ではありません。採否は下の再評価コマンドの実測で決めてください。");
    }

    console.log("\n[ 再評価コマンド ]");
    console.log(`  観測した座標 NULL 率: ${(out.reevaluation.observedNullRate * 100).toFixed(1)}%  ` +
      `(行数 ${counts.total} → ベンチのティア ${out.reevaluation.suggestedRows})`);
    console.log("  実分布を使い捨てクラスタで再現し、C0/C1/C3 の実測差を採る:");
    console.log(`    ${out.reevaluation.command}`);
    console.log("  --hit-rates は Places の 1 ページ 20 件のうち既存店舗に一致する割合。");
    console.log("  DB からは観測できないため既定 0.25 を置いている。実運用の肌感に合わせて上書きすること。");

    console.log("\n" + "=".repeat(88));
    console.log("判定基準とベンチ結果: docs/area-search-index-benchmark.md");
    console.log("=".repeat(88));
  }

  await sql.end({ timeout: 5 });
} catch (err) {
  console.error("DIAGNOSE ERROR:", err instanceof Error ? err.message : String(err));
  await sql.end({ timeout: 5 }).catch(() => {});
  process.exit(1);
}
