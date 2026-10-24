/** 運用データの対象を必ず明示させる。DB接続前に呼び出す (#370)。 */
export function parseTenantSelection(argv) {
  const selections = [];
  for (let i = 0; i < argv.length; i++) {
    const match = argv[i].match(/^--(tenant|tenant-id)(?:=(.*))?$/);
    if (!match) continue;
    const value = match[2] ?? argv[++i];
    if (!value || value.startsWith("--")) throw new Error("--tenant <slug> または --tenant-id <UUID> を指定してください");
    selections.push({ kind: match[1], value });
  }
  if (selections.length !== 1) throw new Error("--tenant <slug> または --tenant-id <UUID> を1つ指定してください");
  const selection = selections[0];
  const valid = selection.kind === "tenant-id"
    ? /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(selection.value)
    : /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(selection.value);
  if (!valid) throw new Error("テナントの指定が不正です");
  return selection;
}

export async function resolveScriptTenant(sql, selection) {
  const rows = selection.kind === "tenant-id"
    ? await sql`select id, slug from tenants where id = ${selection.value}`
    : await sql`select id, slug from tenants where slug = ${selection.value}`;
  if (!rows[0]) throw new Error("指定されたテナントが見つかりません");
  return rows[0];
}
