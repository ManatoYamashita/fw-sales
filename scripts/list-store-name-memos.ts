/**
 * 店舗名に営業メモが書き込まれた店舗の一覧を出す (#297)。読み取り専用。
 *
 * 現場は営業結果を店舗名の先頭に「（Rアポハマロスト）炉端ジュン」のように書いていた。
 * 再アプローチ可否は営業記録に記録できるようになったので、該当店舗を洗い出し、
 * 人の判断でメモを営業記録 / 顧客共有メモへ移してから店舗名を直す。
 * 店舗詳細にも同じ検出 (`splitStoreNameMemo`) による案内と「店舗名を直す」ボタンがある。
 *
 * 出力は Markdown の表 (店舗 ID / 現在の店舗名 / メモ / 直した後の店舗名の候補 /
 * メモを除いた名前が同じ別店舗)。最後の列は「（Rアポハマロスト）炉端ジュン」と
 * 「炉端ジュン」が別レコードで並んでいるような重複登録の手掛かり。
 *
 * 実行: `pnpm db:list-name-memos` (DATABASE_URL は .env.local または環境変数)。
 * 接続様式は verify-store-cascade-fks.mjs と同じ (Node postgres / prepare:false / 単一接続)。
 * SELECT しか発行しない。tsx (CJS 出力) はトップレベル await を通さないため main() で包む。
 */
import postgres from "postgres";
import { splitStoreNameMemo } from "../lib/domain/store-name-memo";

/** Markdown の表を壊す文字を潰す。 */
const cell = (value: string) => value.replace(/\|/g, "\\|").replace(/\s+/g, " ");

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("ERROR: DATABASE_URL is not set.");
    process.exit(1);
  }
  const sql = postgres(url, { prepare: false, max: 1, idle_timeout: 5, connect_timeout: 10 });
  try {
    const rows = await sql<{ id: string; name: string }[]>`
      select id, name from stores order by name`;

    const idsByName = new Map<string, string[]>();
    for (const row of rows) {
      const list = idsByName.get(row.name.trim());
      if (list) list.push(row.id);
      else idsByName.set(row.name.trim(), [row.id]);
    }

    const hits = rows.flatMap((row) => {
      const split = splitStoreNameMemo(row.name);
      return split ? [{ id: row.id, original: row.name, memo: split.memo, suggested: split.name }] : [];
    });

    console.log(`店舗名に営業メモを含む店舗: ${hits.length} 件 / 全 ${rows.length} 件\n`);
    if (hits.length > 0) {
      console.log("| 店舗 ID | 現在の店舗名 | メモ | 店舗名の候補 | 同名の別店舗 |");
      console.log("| --- | --- | --- | --- | --- |");
      for (const hit of hits) {
        const twins = idsByName.get(hit.suggested) ?? [];
        console.log(
          `| ${hit.id} | ${cell(hit.original)} | ${cell(hit.memo)} | ${cell(hit.suggested)} | ${twins.join(", ") || "—"} |`,
        );
      }
    }
  } finally {
    await sql.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
