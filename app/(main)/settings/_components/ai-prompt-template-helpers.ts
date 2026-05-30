import type { FewShotExample } from "@/types/ai-prompt-template";

export { MAX_FREEFORM_LENGTH } from "@/types/ai-prompt-template";

export const MAX_FEWSHOTS = 10;
export const MAX_FEWSHOT_LENGTH = 4000;

export function createEmptyFewshot(): FewShotExample {
  return { title: "", store_meta: "", call_script_ideal: "" };
}

export function calculateFewshotLength(ex: FewShotExample): number {
  return ex.title.length + ex.store_meta.length + ex.call_script_ideal.length;
}

export function canRemoveFewshot(fewshots: FewShotExample[]): boolean {
  return fewshots.length > 1;
}

export function canAddFewshot(fewshots: FewShotExample[]): boolean {
  return fewshots.length < MAX_FEWSHOTS;
}
