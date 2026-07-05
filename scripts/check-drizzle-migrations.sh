#!/usr/bin/env bash
#
# Drizzle マイグレーション整合性チェッカー。
#
# 並行ブランチが同一 idx の `drizzle/00NN_*.sql` を生成し、merge 時にファイル名
# 衝突を解消せずマージすると、後者は `_journal.json` に登録されない孤児となる。
# `pnpm drizzle-kit migrate` は journal 未登録 SQL を黙って無視するため、本番 DB
# に DDL が未適用の状態が発生する (過去事例: `0004_add_store_google_place_id.sql`)。
#
# 本スクリプトは以下 5 種類の不整合を検出する:
#   1. 同一 idx の SQL ファイルが複数存在
#   2. SQL ファイル数と journal entries 数の不一致
#   3. journal に登録された tag に対応する SQL ファイルが欠落
#   4. SQL ファイルが journal に登録されていない (孤児)
#   5. journal の when が idx 順に狭義単調増加でない (水位線スキップの温床)
#
# 不整合があれば exit 1、無ければ exit 0。
#
# 実行: `pnpm db:check` または `bash scripts/check-drizzle-migrations.sh`

set -euo pipefail

MIGRATIONS_DIR="drizzle"
JOURNAL="${MIGRATIONS_DIR}/meta/_journal.json"
exit_code=0

if [ ! -d "$MIGRATIONS_DIR" ]; then
  echo "ERROR: ${MIGRATIONS_DIR}/ directory not found. Run from repository root."
  exit 1
fi

if [ ! -f "$JOURNAL" ]; then
  echo "ERROR: ${JOURNAL} not found."
  exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "ERROR: jq is required but not installed."
  exit 1
fi

list_sql_files() {
  # 4 桁数字_*.sql のみを対象。null-safe (該当ファイル無しなら空)
  find "$MIGRATIONS_DIR" -maxdepth 1 -type f -name '[0-9][0-9][0-9][0-9]_*.sql' \
    -print0 2>/dev/null \
    | xargs -0 -I{} basename {} \
    | sort
}

# Check 1: 同一 idx の SQL ファイル重複
dups=$(list_sql_files | awk -F'_' '{print $1}' | sort | uniq -d || true)
if [ -n "$dups" ]; then
  echo "ERROR: Duplicate migration idx detected:"
  while IFS= read -r idx; do
    echo "  idx=${idx}:"
    list_sql_files | grep -E "^${idx}_" | sed 's/^/    /'
  done <<< "$dups"
  echo ""
  echo "  Resolution: rename or regenerate one of the conflicting files."
  echo "  See docs/auth-and-notifications-deploy-runbook.md §「孤児マイグレーション検出・復旧」"
  exit_code=1
fi

# Check 2: SQL ファイル数と journal entries 数
sql_count=$(list_sql_files | wc -l | tr -d ' ')
journal_count=$(jq '.entries | length' "$JOURNAL")
if [ "$sql_count" != "$journal_count" ]; then
  echo "ERROR: SQL file count (${sql_count}) != journal entries count (${journal_count})"
  echo "  Likely orphan migration (unregistered SQL or missing SQL for journal entry)."
  exit_code=1
fi

# Check 3: journal の各 tag に対応する SQL ファイルが存在
while IFS= read -r tag; do
  file="${MIGRATIONS_DIR}/${tag}.sql"
  if [ ! -f "$file" ]; then
    echo "ERROR: Journal entry '${tag}' references missing SQL file: ${file}"
    exit_code=1
  fi
done < <(jq -r '.entries[].tag' "$JOURNAL")

# Check 4: 各 SQL ファイルが journal に登録されている
while IFS= read -r filename; do
  tag="${filename%.sql}"
  if ! jq -e --arg tag "$tag" '.entries | map(.tag) | index($tag) != null' "$JOURNAL" >/dev/null; then
    echo "ERROR: SQL file '${MIGRATIONS_DIR}/${filename}' has no journal entry (orphan)."
    echo "  Resolution: delete the orphan and re-run \`pnpm drizzle-kit generate --name <name>\`,"
    echo "  or rename to a unique idx and manually add to ${JOURNAL}."
    exit_code=1
  fi
done < <(list_sql_files)

# Check 5: journal の when が idx 順に狭義単調増加であること (水位線ガード)
#
# drizzle-kit migrate は「適用済み最終行の created_at (水位線) より新しい when のみ適用」する。
# journal 上で when が idx 順に対して逆行・同値になると、後続 migration の適用後に
# 古い when の migration が永久にスキップされる。
# 過去事例: 0015_store_cascade_delete が本番未適用のまま 0016 以降が適用され、
# FK が NO ACTION のまま残存 → 店舗削除が 23503 でブロック (Issue #152)。
check5_errors=$(jq -r '
  .entries
  | sort_by(.idx)
  | . as $e
  | [range(1; length)
     | select($e[.].when <= $e[. - 1].when)
     | "  idx=\($e[.].idx) tag=\($e[.].tag) when=\($e[.].when) <= idx=\($e[. - 1].idx) when=\($e[. - 1].when)"]
  | .[]' "$JOURNAL")
if [ -n "$check5_errors" ]; then
  echo "ERROR: Journal 'when' values must be strictly increasing by idx (watermark guard):"
  echo "$check5_errors"
  echo ""
  echo "  when が適用済み水位線を下回る migration は drizzle-kit migrate に永久スキップされます。"
  echo "  Resolution: 該当 migration を \`pnpm db:generate --custom --name=<name>\` で"
  echo "  新しい idx / when として再生成してください (_journal.json の手書き編集は不可)。"
  exit_code=1
fi

if [ "$exit_code" -eq 0 ]; then
  echo "OK: ${sql_count} Drizzle migrations, all consistent with journal."
fi

exit "$exit_code"
