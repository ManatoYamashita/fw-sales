/**
 * migration の「適用来歴」を検証する読み取り専用スクリプト。
 *
 * `drizzle/meta/_journal.json` の各 entry と `drizzle.__drizzle_migrations` の
 * 実レコードを突き合わせ、3 種類の乖離を検出する。
 *
 * ## なぜ必要か
 *
 * `drizzle-kit migrate` は **hash では適用判定しない**。`__drizzle_migrations` の
 * `created_at` 最大値を水位線として、それより新しい `when` を持つ journal entry だけを
 * 適用する。この性質から、CI が緑でも本番だけ壊れる事故が2度起きている:
 *
 * - **#152**: 並行ブランチで `0015` が既適用 migration より古い `when` を持って
 *   main に入り、**恒久的にスキップ**された。FK が `NO ACTION` のまま残り、
 *   店舗削除が本番でだけ失敗した (`0021` の custom migration で是正)
 * - **orphan migration**: idx 衝突で `_journal.json` に載らない SQL が適用され、
 *   本番にだけ存在する列ができた
 *
 * どちらも「journal と DB の来歴のズレ」であり、DDL を1回 SELECT すれば検出できる。
 *
 * ## 検出する3種別
 *
 * | 種別 | 条件 | 意味 |
 * | --- | --- | --- |
 * | `drift` | `when` の行はあるがどれとも hash が一致しない | 適用**後**に .sql が編集された。DB と repo の SQL が別物 |
 * | `not_applied` | `when` の行が無い | 水位線を追い越せず**今後も適用されない**。#152 と同型 |
 * | `orphan` | journal のどの `when` とも一致しない DB 行 | repo に無い SQL が本番に適用されている |
 * | `duplicate_apply` | 同一 `when` に複数の適用記録 | 同じ slot が別内容で2回適用された |
 *
 * ## `created_at` は一意ではない (実測)
 *
 * `__drizzle_migrations` には **同一 `created_at` の行が複数存在しうる**
 * (本番実測: 2 つの `created_at` にそれぞれ 2 行)。したがって
 * `Map<created_at, hash>` で突き合わせてはいけない。後勝ちで上書きされ、
 * 「片方が一致するから ok」と「もう片方の drift」を**同時に取りこぼす**。
 * ここでは `Map<created_at, hash[]>` で全件を保持し、`includes` で判定する。
 *
 * ## このスクリプトが検証しないこと
 *
 * **スキーマの一致は見ない。** 見るのは来歴だけ。列や制約の実態は
 * `pnpm db:check` (drizzle 側の整合チェック) と `pnpm db:verify-fks` が担う。
 * `not_applied` があっても、後続の migration が同じ結果を作っていればスキーマは
 * 正しい (実際 `0015` は `0021` が是正済み)。だからこそ既知分は allowlist へ置き、
 * **新規の乖離だけ**を落とす。
 *
 * 実行: `pnpm db:verify-hashes` (DATABASE_URL は .env.local または環境変数から供給)。
 * 接続様式は `verify-store-cascade-fks.mjs` と同一 (Node postgres / prepare:false /
 * 単一接続)。psql (libpq) は DATABASE_URL 中の特殊文字を host と誤読するため使わない。
 * 接続文字列や hash 全文はログに出力しない (先頭 12 文字のみ)。
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import postgres from "postgres";

const JOURNAL_PATH = "drizzle/meta/_journal.json";

/**
 * 既知の乖離 (2026-08-16 時点の本番実測)。ここに載っているものは exit code に
 * 影響しないが、毎回 `KNOWN` として一覧表示する (黙って隠さない)。
 *
 * **新しい乖離をここへ足すのは、原因を特定して安全だと判断した場合だけ。**
 * 追加する際は必ず `reason` に「なぜ実害が無いか」を書く。書けないなら、それは
 * allowlist ではなく修正が必要な事象である。
 */
const KNOWN_DEVIATIONS = [
  {
    kind: "duplicate_apply",
    tag: "0009_add_api_updated_at",
    reason:
      "同じ when に別内容の適用記録が1件余分にある。現行 .sql と一致する記録も存在し、対象テーブル (deep_research 系) は 0017 で削除済みのため現行スキーマに影響しない。",
  },
  {
    kind: "duplicate_apply",
    tag: "0010_add_ai_prompt_templates",
    reason:
      "同上。ai_prompt_templates の現行スキーマは schema.ts と db:check で一致確認済み。",
  },
  {
    kind: "drift",
    tag: "0016_add_store_basic_info",
    reason:
      "0016 は soft delete 列の ADD COLUMN 誤混入 (PR #111) を手修正した際に .sql を書き換えたため。適用済み DDL は stores.basic_info の追加で、現行スキーマと一致している。",
  },
  {
    kind: "drift",
    tag: "0025_add_store_research_runs",
    reason:
      "PR #180 merge 前にリポジトリ外の版が手作業で適用された。列16/FK2/索引3 すべて現行 .sql と一致することを実測確認済み (schema drift なし)。",
  },
  {
    kind: "not_applied",
    tag: "0007_add_store_google_place_id",
    reason:
      "並行ブランチの idx 衝突で孤児化し、2026-05-17 に再生成して解決した際の残骸。stores.google_place_id は本番に存在する。",
  },
  {
    kind: "not_applied",
    tag: "0013_add_research_job_soft_delete",
    reason:
      "対象の research_job 系テーブルは 0017 で削除済みのため、適用されなくても実害が無い。",
  },
  {
    kind: "not_applied",
    tag: "0014_ensure_research_job_soft_delete_columns",
    reason: "同上 (0013 の追従 migration)。",
  },
  {
    kind: "not_applied",
    tag: "0015_store_cascade_delete",
    reason:
      "#152 の当該事象。水位線スキップで恒久未適用となったが、0021_reassert_store_cascade_fks が同じ FK を張り直して是正済み (db:verify-fks が exit 0)。",
  },
  {
    kind: "orphan",
    createdAt: 1778976000000,
    reason:
      "0007 の孤児版 (上記 0007 と対になる)。再生成前の SQL が適用された記録で、現行スキーマは正しい。",
  },
];

function shortHash(h) {
  return typeof h === "string" ? `${h.slice(0, 12)}…` : "(none)";
}

function isKnown(kind, key) {
  return KNOWN_DEVIATIONS.some(
    (d) => d.kind === kind && (d.tag === key || String(d.createdAt) === String(key)),
  );
}

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("ERROR: DATABASE_URL is not set.");
  process.exit(1);
}

let journal;
try {
  journal = JSON.parse(fs.readFileSync(JOURNAL_PATH, "utf8"));
} catch (e) {
  console.error(`ERROR: ${JOURNAL_PATH} を読めません: ${e.message}`);
  process.exit(1);
}

const sql = postgres(url, {
  prepare: false,
  max: 1,
  idle_timeout: 5,
  connect_timeout: 10,
});

let exitCode = 0;

try {
  const rows = await sql`
    select hash, created_at
    from drizzle.__drizzle_migrations
    order by created_at`;

  // drizzle-kit は journal の `when` をそのまま `created_at` として記録する。
  // 同一 created_at に複数行がありうるため、必ず配列で保持する (上の JSDoc 参照)。
  const dbByWhen = new Map();
  for (const r of rows) {
    const key = String(r.created_at);
    const list = dbByWhen.get(key);
    if (list) list.push(r.hash);
    else dbByWhen.set(key, [r.hash]);
  }
  const journalWhens = new Set(journal.entries.map((e) => String(e.when)));

  const newDeviations = [];
  const knownSeen = [];

  for (const entry of journal.entries) {
    const file = path.join("drizzle", `${entry.tag}.sql`);
    let localHash;
    try {
      localHash = crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
    } catch (e) {
      newDeviations.push({
        kind: "missing_file",
        tag: entry.tag,
        detail: `journal に載っているが ${file} が存在しない (${e.code ?? e.message})`,
      });
      continue;
    }

    const dbHashes = dbByWhen.get(String(entry.when)) ?? [];

    if (dbHashes.length === 0) {
      const d = {
        kind: "not_applied",
        tag: entry.tag,
        detail: `when=${entry.when} の適用記録が無い (水位線を追い越せず今後も適用されない)`,
      };
      (isKnown("not_applied", entry.tag) ? knownSeen : newDeviations).push(d);
      continue;
    }

    if (!dbHashes.includes(localHash)) {
      const d = {
        kind: "drift",
        tag: entry.tag,
        detail: `db=[${dbHashes.map(shortHash).join(", ")}] file=${shortHash(localHash)} (適用後に .sql が編集された)`,
      };
      (isKnown("drift", entry.tag) ? knownSeen : newDeviations).push(d);
      continue;
    }

    // hash は一致しているが、同じ slot に複数の適用記録がある。
    // 一致しない側は「別内容で一度適用された」痕跡であり、黙って無視しない。
    if (dbHashes.length > 1) {
      const others = dbHashes.filter((h) => h !== localHash);
      const d = {
        kind: "duplicate_apply",
        tag: entry.tag,
        detail: `when=${entry.when} に適用記録が ${dbHashes.length} 件ある (現行 .sql と一致しない記録: [${others.map(shortHash).join(", ")}])`,
      };
      (isKnown("duplicate_apply", entry.tag) ? knownSeen : newDeviations).push(d);
    }
  }

  for (const r of rows) {
    if (journalWhens.has(String(r.created_at))) continue;
    const d = {
      kind: "orphan",
      tag: `created_at=${r.created_at}`,
      detail: `journal のどの entry とも対応しない適用記録 (hash=${shortHash(r.hash)})`,
    };
    (isKnown("orphan", r.created_at) ? knownSeen : newDeviations).push(d);
  }

  console.log(
    `journal entries: ${journal.entries.length} / applied rows: ${rows.length}`,
  );

  if (knownSeen.length > 0) {
    console.log(`\nKNOWN (allowlist 済み、exit code に影響しない) — ${knownSeen.length} 件`);
    for (const d of knownSeen) {
      const reason =
        KNOWN_DEVIATIONS.find(
          (k) => k.kind === d.kind && (k.tag === d.tag || d.tag === `created_at=${k.createdAt}`),
        )?.reason ?? "";
      console.log(`  [${d.kind}] ${d.tag}`);
      console.log(`      ${reason}`);
    }
  }

  if (newDeviations.length === 0) {
    console.log("\nOK: 新規の乖離はありません。");
  } else {
    exitCode = 1;
    console.error(`\nNG: 新規の乖離が ${newDeviations.length} 件あります。`);
    for (const d of newDeviations) {
      console.error(`  [${d.kind}] ${d.tag}`);
      console.error(`      ${d.detail}`);
    }
    console.error(
      [
        "",
        "対処:",
        "  drift       — 適用済み migration の .sql は編集しないこと。変更が必要なら新しい migration を追加する。",
        "  not_applied — journal の when が既適用の最大 created_at より古い。migration を再生成して",
        "                journal の末尾に置き直す (#152 と同型の事故)。",
        "  orphan      — repo に無い SQL が適用されている。並行ブランチの idx 衝突を疑う。",
        "  missing_file— journal と drizzle/*.sql の不整合。",
        "",
        "原因を特定し「実害が無い」と判断できた場合に限り、",
        "scripts/verify-migration-hashes.mjs の KNOWN_DEVIATIONS へ理由付きで追加する。",
      ].join("\n"),
    );
  }
} catch (e) {
  console.error(`ERROR: 検証に失敗しました: ${e.message}`);
  exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}

process.exit(exitCode);
