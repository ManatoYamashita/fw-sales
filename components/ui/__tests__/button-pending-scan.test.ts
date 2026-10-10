/**
 * 処理中のボタンが `pending` prop を通っていることを固定する (#326)。
 *
 * 走査が空振りしても「違反 0 件」で緑になるため、検知力を先に立証する。
 * negative control は #326 で直す前の**実際の原文**をそのまま置いている。
 */

import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { scanButtonPending } from "./support/button-pending-scan";

/** 確認ダイアログの削除ボタン (store-delete-confirm-dialog.tsx、#326 以前)。 */
const BEFORE_DISABLED_TOGGLE = `
<ModalFooter>
  <Button
    variant="ghost"
    onClick={() => onOpenChange(false)}
    disabled={pending}
  >
    キャンセル
  </Button>
  <Button variant="danger" onClick={onConfirm} disabled={pending}>
    {pending ? "削除中…" : "削除する"}
  </Button>
</ModalFooter>`;

/** URL 読込ボタン (registration-mode-card.tsx、#326 以前)。 */
const BEFORE_MANUAL_SPINNER = `
<Button
  variant="primary"
  onClick={importNow}
  disabled={pending}
  className="sm:w-32 gap-2"
>
  {pending ? (
    <>
      <Spinner tone="primary" />
      読込中…
    </>
  ) : (
    <>
      <Download className="h-4 w-4" />
      読込
    </>
  )}
</Button>`;

/** 探索チップ (area-search-results.tsx、#326 以前)。条件が disabled と別の式。 */
const BEFORE_CHIP_SPINNER = `
<Button
  key={chip}
  variant={exploredRunIds.has(runId) ? "ghost" : "outline"}
  size="sm"
  gap="tight"
  onClick={() => handleExplore("keyword", chip)}
  disabled={
    explorationPendingId !== null || exploredRunIds.has(runId)
  }
>
  {explorationPendingId === runId && <Spinner size="sm" />}
  {chip}
  {exploredRunIds.has(runId) && (
    <span className="text-xs text-muted-foreground">探索済み</span>
  )}
</Button>`;

/** デフォルト変更ボタン (ai-prompt-template-dialog.tsx、#326 以前)。disabled と別の変数で文言を切り替える。 */
const BEFORE_BUSY_LABEL = `
<Button
  size="sm"
  variant="ghost"
  onClick={() => onSetDefault(t.id)}
  disabled={isAnyChanging}
>
  <Star className="h-3.5 w-3.5" />
  <span className="hidden sm:inline">
    {isChangingThis ? "変更中…" : "デフォルトにする"}
  </span>
</Button>`;

describe("scanButtonPending の検知力", () => {
  it("disabled と同じ条件で文言を切り替える起動ボタンを検出し、キャンセル側は見逃す", () => {
    const violations = scanButtonPending(BEFORE_DISABLED_TOGGLE);
    expect(violations.map((v) => v.kind)).toEqual(["disabled-toggle"]);
    expect(violations[0]?.text).toContain('variant="danger"');
  });

  it("ボタンの中に手で置いた Spinner を検出する", () => {
    const kinds = scanButtonPending(BEFORE_MANUAL_SPINNER).map((v) => v.kind);
    expect(kinds).toContain("manual-spinner");
  });

  it("条件が disabled と別の式でも、手置きの Spinner は検出する", () => {
    const kinds = scanButtonPending(BEFORE_CHIP_SPINNER).map((v) => v.kind);
    expect(kinds).toContain("manual-spinner");
  });

  it("disabled と別の変数で処理中の文言へ切り替えるボタンを検出する", () => {
    const kinds = scanButtonPending(BEFORE_BUSY_LABEL).map((v) => v.kind);
    expect(kinds).toEqual(["busy-label"]);
  });

  it("「サインイン中...」のように ... で終わる文言も処理中とみなす", () => {
    const source = `<Button onClick={go}>{isPending ? "サインイン中..." : "サインイン"}</Button>`;
    expect(scanButtonPending(source).map((v) => v.kind)).toEqual(["busy-label"]);
  });

  it("直した形 (pending を渡す) は違反にならない", () => {
    const fixed = [
      `<Button variant="danger" onClick={onConfirm} pending={pending}>{pending ? "削除中…" : "削除する"}</Button>`,
      `<Button pending={isChangingThis} disabled={isAnyChanging}>{isChangingThis ? "変更中…" : "デフォルトにする"}</Button>`,
      `<Button pending={explorationPendingId === runId} disabled={explorationPendingId !== null || exploredRunIds.has(runId)}>{chip}{exploredRunIds.has(runId) && <span>探索済み</span>}</Button>`,
    ];
    for (const source of fixed) expect(scanButtonPending(source)).toEqual([]);
  });

  it("Button 以外 (ButtonGroup など前方一致の別名) は見ない", () => {
    const source = `<ButtonGroup disabled={pending}>{pending ? "保存中…" : "保存"}<Spinner /></ButtonGroup>`;
    expect(scanButtonPending(source)).toEqual([]);
  });
});

describe("リポジトリ全体", () => {
  const files = execSync(
    "git ls-files 'app/**/*.tsx' 'components/**/*.tsx'",
    { encoding: "utf8" },
  )
    .trim()
    .split("\n")
    .filter((f) => !f.includes("__tests__"));

  it("走査対象が空でない (空振りしていない)", () => {
    expect(files.length).toBeGreaterThan(100);
    const pendingUses = files
      .map((f) => readFileSync(f, "utf8").match(/\bpending=\{/g)?.length ?? 0)
      .reduce((a, b) => a + b, 0);
    // #326 で置き換えた起動ボタンの数 (38) を下回ったら、走査か置き換えが壊れている。
    expect(pendingUses).toBeGreaterThanOrEqual(38);
  });

  it("処理中のボタンはすべて pending を通している", () => {
    const violations = files.flatMap((file) =>
      scanButtonPending(readFileSync(file, "utf8"), file).map(
        (v) => `${file}:${v.line} ${v.kind} ${v.text}`,
      ),
    );
    expect(violations).toEqual([]);
  });
});
