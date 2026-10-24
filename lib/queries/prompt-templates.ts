import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import { repos } from "@/lib/repositories";
import { CACHE_TAGS } from "@/lib/cache";
import type { AiPromptTemplate } from "@/types/ai-prompt-template";

export async function listPromptTemplatesCached(
  tenantId: string,
  userId: string,
): Promise<AiPromptTemplate[]> {
  "use cache";
  cacheLife("longBackstop");
  cacheTag(CACHE_TAGS.promptTemplates(tenantId));
  return repos.promptTemplate.list(userId);
}
