import { describe, expect, it } from "vitest";
import {
  BUILTIN_FEWSHOT_EXAMPLES,
  BUILTIN_PROMPT_TEMPLATE_ID,
  BUILTIN_PROMPT_TEMPLATE_NAME,
  getBuiltinTemplateBody,
} from "../builtin-prompt-template";

describe("builtin-prompt-template", () => {
  it("標準テンプレートの ID と名称が定義されている", () => {
    expect(BUILTIN_PROMPT_TEMPLATE_ID).toBe("__builtin__");
    expect(BUILTIN_PROMPT_TEMPLATE_NAME).toBe("標準テンプレート");
  });

  it("Few-shot 例が 2 件定義されている", () => {
    expect(BUILTIN_FEWSHOT_EXAMPLES).toHaveLength(2);
  });

  it("各 Few-shot 例に必須フィールドと {ASSIGNED_SALES} が含まれる", () => {
    for (const ex of BUILTIN_FEWSHOT_EXAMPLES) {
      expect(ex.title.trim().length).toBeGreaterThan(0);
      expect(ex.store_meta.trim().length).toBeGreaterThan(0);
      expect(ex.call_script_ideal.trim().length).toBeGreaterThan(0);
      expect(ex.call_script_ideal).toContain("{ASSIGNED_SALES}");
    }
  });

  it("導楽 / 蕎楽亭の食べログ URL が含まれる", () => {
    const metas = BUILTIN_FEWSHOT_EXAMPLES.map((ex) => ex.store_meta).join("\n");
    expect(metas).toMatch(/A1405\/A140504\/14096697/);
    expect(metas).toMatch(/A1309\/A130905\/13000479/);
  });

  it("getBuiltinTemplateBody が fewshots 形式を返す", () => {
    const body = getBuiltinTemplateBody();
    expect(body.kind).toBe("fewshots");
    if (body.kind === "fewshots") {
      expect(body.fewshots).toHaveLength(2);
    }
  });
});
