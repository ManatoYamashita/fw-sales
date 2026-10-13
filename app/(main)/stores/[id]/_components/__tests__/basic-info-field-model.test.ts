/**
 * 「店舗の調査情報」カードの入力欄まわりの判定 (#335)。
 *
 * 日本語 IME の変換確定で保存しないこと、Textarea の Enter が改行のままであること、
 * 空白だけの違いで「保存」を出さないこと、採用と手入力の由来を取り違えないことを固定する。
 */

import { describe, expect, it } from "vitest";
import { EDITED_SOURCE_QUOTE } from "@/lib/domain/research-review";
import type { BasicInfoField } from "@/types/basic-info";
import {
  describeFieldOrigin,
  estimateTextareaRows,
  formatUpdatedAt,
  isDraftDirty,
  readFieldKeyCommand,
  usesSingleLineInput,
} from "../basic-info-field-model";

const key = (overrides: Partial<Parameters<typeof readFieldKeyCommand>[0]> = {}) => ({
  key: "Enter",
  isComposing: false,
  keyCode: 13,
  ctrlKey: false,
  metaKey: false,
  ...overrides,
});

describe("readFieldKeyCommand", () => {
  it("IME の変換中・変換確定の Enter では保存も取消もしない", () => {
    const options = { multiline: true, dirty: true };
    expect(readFieldKeyCommand(key({ ctrlKey: true, isComposing: true }), options)).toBeNull();
    // Safari は変換確定の Enter を keyCode 229 で返し、isComposing が false になることがある。
    expect(readFieldKeyCommand(key({ ctrlKey: true, keyCode: 229 }), options)).toBeNull();
    expect(readFieldKeyCommand(key({ key: "Escape", isComposing: true }), options)).toBeNull();
  });

  it("Textarea の Enter は改行のまま。Ctrl / ⌘ + Enter で保存する", () => {
    const options = { multiline: true, dirty: true };
    expect(readFieldKeyCommand(key(), options)).toBeNull();
    expect(readFieldKeyCommand(key({ ctrlKey: true }), options)).toBe("save");
    expect(readFieldKeyCommand(key({ metaKey: true }), options)).toBe("save");
  });

  it("1 行の Input の Enter はフォーム送信に任せる (ここでは扱わない)", () => {
    expect(readFieldKeyCommand(key(), { multiline: false, dirty: true })).toBeNull();
    expect(readFieldKeyCommand(key({ ctrlKey: true }), { multiline: false, dirty: true })).toBeNull();
  });

  it("Escape は未保存の変更があるときだけ取消にする", () => {
    expect(readFieldKeyCommand(key({ key: "Escape" }), { multiline: false, dirty: true })).toBe("cancel");
    expect(readFieldKeyCommand(key({ key: "Escape" }), { multiline: false, dirty: false })).toBeNull();
  });

  it("Tab などフォーカス移動のキーでは何もしない (未保存の値を捨てない)", () => {
    expect(readFieldKeyCommand(key({ key: "Tab" }), { multiline: true, dirty: true })).toBeNull();
  });
});

describe("isDraftDirty", () => {
  it("前後の空白だけの違いは変更として扱わない", () => {
    expect(isDraftDirty("  炉端ジュン ", "炉端ジュン")).toBe(false);
    expect(isDraftDirty("炉端ジュン本店", "炉端ジュン")).toBe(true);
    expect(isDraftDirty("", "炉端ジュン")).toBe(true);
    expect(isDraftDirty(" ", "")).toBe(false);
  });
});

describe("usesSingleLineInput / estimateTextareaRows", () => {
  it("短い項目は Input、長文の項目と改行を含む値は Textarea", () => {
    expect(usesSingleLineInput("phone", "03-1234-5678")).toBe(true);
    expect(usesSingleLineInput("concept", "")).toBe(false);
    expect(usesSingleLineInput("address", "")).toBe(false);
    // Input は改行を落とすため、開いただけで値が変わらないよう Textarea にする。
    expect(usesSingleLineInput("phone", "03-1234-5678\n050-1111-2222")).toBe(false);
  });

  it("未対応ブラウザ向けの行数は 1〜8 行に収める", () => {
    expect(estimateTextareaRows("")).toBe(1);
    expect(estimateTextareaRows("a\nb\nc")).toBe(3);
    expect(estimateTextareaRows("あ".repeat(81))).toBe(3);
    expect(estimateTextareaRows("x\n".repeat(20))).toBe(8);
  });
});

describe("describeFieldOrigin", () => {
  const base: BasicInfoField = {
    value: "v",
    tier: "A",
    filled_by: "manual",
    updated_at: "2026-10-10T00:00:00.000Z",
  };

  it("調査レビューの採用 (根拠あり) を直接入力と表示しない", () => {
    expect(describeFieldOrigin({ ...base, source_quote: "公式サイトに記載" })).toBe(
      "AI調査の結果をレビューで採用",
    );
  });

  it("根拠の無い manual は人が入力した値。編集して採用した値もここに入ることを明示する", () => {
    expect(describeFieldOrigin(base)).toContain("人が入力した値");
    expect(describeFieldOrigin({ ...base, source_quote: EDITED_SOURCE_QUOTE })).toContain(
      "編集して採用",
    );
  });

  it("Places 由来はエリア検索", () => {
    expect(describeFieldOrigin({ ...base, filled_by: "places" })).toContain("エリア検索");
  });
});

describe("formatUpdatedAt", () => {
  it("サーバとブラウザで同じになるよう日本時間で表示する", () => {
    expect(formatUpdatedAt("2026-10-09T15:30:00.000Z")).toBe("2026/10/10 00:30");
  });

  it("空・不正な値は出さない", () => {
    expect(formatUpdatedAt(undefined)).toBeNull();
    expect(formatUpdatedAt("")).toBeNull();
    expect(formatUpdatedAt("not-a-date")).toBeNull();
  });
});
