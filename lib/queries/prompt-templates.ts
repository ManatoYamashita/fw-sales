import "server-only";
import { cacheTag } from "next/cache";
import { repos } from "@/lib/repositories";
import { CACHE_TAGS } from "@/lib/cache";
import type { AiPromptTemplate } from "@/types/ai-prompt-template";

export async function listPromptTemplatesCached(
  userId: string,
): Promise<AiPromptTemplate[]> {
  "use cache";
  cacheTag(CACHE_TAGS.promptTemplates);
  return repos.promptTemplate.list(userId);
}
