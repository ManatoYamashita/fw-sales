#!/usr/bin/env bash
#
# エリア検索 bbox 候補取得 (findAreaSearchCandidates) の index ベンチマーク実行環境 (Issue #162)。
#
# 使い捨ての PostgreSQL クラスタを一時ディレクトリに initdb して起動し、実際の
# migration チェーンでスキーマを構築したうえで scripts/bench-area-search-index.mjs
# を実行する。終了時 (異常終了・Ctrl-C を含む) にクラスタを停止し一時ディレクトリを削除する。
#
# 本番 DB には一切接続しない。ベンチ側は DATABASE_URL を読まず BENCH_DATABASE_URL のみ
# を使い、.mjs 側でも接続先が localhost の bench ポートであることを検証する。
# drizzle-kit は `pnpm db:migrate` 経由で呼ばない (--env-file-if-exists=.env.local が
# 本番 URL を読み込むため)。bin.cjs を直接叩き、環境変数を明示的に与える。
#
# planner 設定は本番 (Supabase / PostgreSQL 17.6) の pg_settings 実測値に合わせる。
# 特に random_page_cost は本番 1.1 に対し PostgreSQL 既定が 4.0 で、既定のまま測ると
# index scan を不当に不利に評価してしまうため必須。
#
# 実行: bash scripts/bench-area-search-index.sh [--rows=N,...] [--null-rates=R,...] [--seed=S]
#       引数はそのまま .mjs へ渡される。
#
# 環境変数:
#   PG_BIN         PostgreSQL バイナリのディレクトリ (既定: postgresql@17 → @16 の順に自動解決)
#   BENCH_PG_PORT  ベンチクラスタのポート (既定: 55432。5432 は既存クラスタが使う場合があるため分離)

set -euo pipefail

if [ ! -f "package.json" ] || [ ! -d "drizzle" ]; then
  echo "ERROR: リポジトリルートから実行してください。" >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# PostgreSQL バイナリの解決
# ---------------------------------------------------------------------------
if [ -z "${PG_BIN:-}" ]; then
  for candidate in \
    /opt/homebrew/opt/postgresql@17/bin \
    /usr/local/opt/postgresql@17/bin \
    /opt/homebrew/opt/postgresql@16/bin \
    /usr/local/opt/postgresql@16/bin; do
    if [ -x "${candidate}/initdb" ]; then
      PG_BIN="$candidate"
      break
    fi
  done
fi

if [ -z "${PG_BIN:-}" ] || [ ! -x "${PG_BIN}/initdb" ]; then
  echo "ERROR: initdb が見つかりません。PG_BIN を設定するか postgresql@17 を導入してください。" >&2
  echo "       brew install postgresql@17" >&2
  exit 1
fi

PG_VERSION="$("${PG_BIN}/postgres" --version)"
echo "==> PostgreSQL: ${PG_VERSION}"
echo "    PG_BIN=${PG_BIN}"

# 本番は PostgreSQL 17.6。17 は btree の `= ANY(...)` スキャンを大きく改善しており、
# 本件のクエリ形状 (google_place_id IN (...) OR bbox) はその影響域にあるため、
# メジャーバージョンがずれた計測結果は本番挙動を代表しない。
case "$PG_VERSION" in
  *"PostgreSQL) 17"*) ;;
  *)
    echo "" >&2
    echo "WARNING: 本番は PostgreSQL 17.6 ですが、このベンチは上記バージョンで実行されます。" >&2
    echo "         plan 形状は示唆的ですが、絶対値は本番を代表しません。" >&2
    echo "         推奨: brew install postgresql@17" >&2
    echo "" >&2
    ;;
esac

# ---------------------------------------------------------------------------
# ポートの確保
# ---------------------------------------------------------------------------
PORT="${BENCH_PG_PORT:-55432}"
if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "ERROR: ポート ${PORT} は既に使用中です。BENCH_PG_PORT で別のポートを指定してください。" >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# 使い捨てクラスタのライフサイクル
# ---------------------------------------------------------------------------
TMPROOT="$(mktemp -d -t fw-sales-bench)"
PGDATA="${TMPROOT}/data"
PGLOG="${TMPROOT}/pg.log"

# 停止を確認してから削除する。順序を逆にすると、SIGPIPE などで中断された際に
# データディレクトリだけ消えて postmaster が生き残り、ポートを掴んだままの孤児になる。
cleanup() {
  local status=$?
  trap - EXIT INT TERM HUP PIPE

  if [ $status -ne 0 ] && [ -f "$PGLOG" ]; then
    echo "--- postgres log (tail) ---" >&2
    tail -20 "$PGLOG" >&2 || true
    echo "---------------------------" >&2
  fi

  if [ -d "$PGDATA" ]; then
    "${PG_BIN}/pg_ctl" -D "$PGDATA" -m immediate -w stop >/dev/null 2>&1 || true
    # pg_ctl が失敗した場合に備え postmaster.pid から直接止める
    if [ -f "${PGDATA}/postmaster.pid" ]; then
      local pm_pid
      pm_pid="$(head -1 "${PGDATA}/postmaster.pid" 2>/dev/null || true)"
      if [ -n "${pm_pid:-}" ] && kill -0 "$pm_pid" 2>/dev/null; then
        kill -QUIT "$pm_pid" 2>/dev/null || true
        sleep 1
        kill -KILL "$pm_pid" 2>/dev/null || true
      fi
    fi
  fi

  rm -rf "$TMPROOT"

  if lsof -nP -iTCP:"${PORT}" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "WARNING: ポート ${PORT} がまだ使用中です。手動で確認してください:" >&2
    echo "         lsof -nP -iTCP:${PORT} -sTCP:LISTEN" >&2
  fi

  if [ $status -ne 0 ]; then
    echo "==> 異常終了 (exit ${status})。クラスタは破棄しました。" >&2
  else
    echo "==> クラスタを停止し一時ディレクトリを破棄しました。"
  fi
}
trap cleanup EXIT INT TERM HUP PIPE

echo "==> initdb (${PGDATA})"
"${PG_BIN}/initdb" -D "$PGDATA" -U postgres --encoding=UTF8 --locale=C >/dev/null

# planner 設定は本番 (Supabase PostgreSQL 17.6) の pg_settings 実測値に一致させる。
# 取得元: scripts/diagnose-area-search-plan.mjs の planner settings セクション。
PG_OPTS="-p ${PORT}"
PG_OPTS="${PG_OPTS} -c listen_addresses=127.0.0.1"
PG_OPTS="${PG_OPTS} -c shared_buffers=224MB"              # 本番 28672 * 8kB
PG_OPTS="${PG_OPTS} -c effective_cache_size=384MB"        # 本番 49152 * 8kB
PG_OPTS="${PG_OPTS} -c work_mem=2184kB"                   # 本番実測
PG_OPTS="${PG_OPTS} -c maintenance_work_mem=32MB"         # 本番 32768kB
PG_OPTS="${PG_OPTS} -c random_page_cost=1.1"              # 本番実測 (既定 4.0 だと index を過小評価)
PG_OPTS="${PG_OPTS} -c seq_page_cost=1"
PG_OPTS="${PG_OPTS} -c cpu_tuple_cost=0.01"
PG_OPTS="${PG_OPTS} -c cpu_index_tuple_cost=0.005"
PG_OPTS="${PG_OPTS} -c cpu_operator_cost=0.0025"
# 本番は 200 だが macOS は posix_fadvise を欠くため 0 以外を設定できない。
# 影響: Bitmap Heap Scan の先読みが効かなくなり index (bitmap) 経路が不利になる。
# = index を採用しにくい方向のバイアスであり、判定としては保守的側に倒れる。
PG_OPTS="${PG_OPTS} -c effective_io_concurrency=0"
PG_OPTS="${PG_OPTS} -c max_parallel_workers_per_gather=1"
PG_OPTS="${PG_OPTS} -c min_parallel_table_scan_size=8MB"  # 本番 1024 * 8kB
PG_OPTS="${PG_OPTS} -c jit=off"                           # 本番実測
PG_OPTS="${PG_OPTS} -c default_statistics_target=100"
PG_OPTS="${PG_OPTS} -c fsync=off"                         # 使い捨てクラスタのため投入を高速化
PG_OPTS="${PG_OPTS} -c synchronous_commit=off"
PG_OPTS="${PG_OPTS} -c full_page_writes=off"

echo "==> pg_ctl start (port ${PORT})"
"${PG_BIN}/pg_ctl" -D "$PGDATA" -l "$PGLOG" -o "$PG_OPTS" -w start >/dev/null

export BENCH_DATABASE_URL="postgresql://postgres@127.0.0.1:${PORT}/bench"
export BENCH_PG_PORT="$PORT"

echo "==> createdb bench"
"${PG_BIN}/createdb" -h 127.0.0.1 -p "$PORT" -U postgres bench

# drizzle/0004 が auth.users への cross-schema FK と AFTER INSERT trigger を持つため、
# 素の PostgreSQL では migration が失敗する。参照される列のみのスタブを用意する。
echo "==> auth.users スタブを作成"
"${PG_BIN}/psql" -h 127.0.0.1 -p "$PORT" -U postgres -d bench -v ON_ERROR_STOP=1 -q <<'SQL'
CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE IF NOT EXISTS auth.users (
  id uuid PRIMARY KEY,
  email text,
  raw_user_meta_data jsonb
);
SQL

# `pnpm db:migrate` は --env-file-if-exists=.env.local を含み本番 URL を読むため使わない。
echo "==> migration チェーンを適用"
DATABASE_URL="$BENCH_DATABASE_URL" node ./node_modules/drizzle-kit/bin.cjs migrate

echo "==> ベンチ実行"
echo ""
node scripts/bench-area-search-index.mjs "$@"
