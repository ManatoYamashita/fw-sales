import { getCurrentSession } from "@/lib/supabase/server";
import { listPromptTemplatesCached } from "@/lib/queries/prompt-templates";
import { AiPromptTemplatesShell } from "./ai-prompt-template-dialog";
import type { AiPromptTemplate } from "@/types/ai-prompt-template";
import { resolveTenantId } from "@/lib/tenant/context";

export async function AiPromptTemplatesCard() {
  const tenantId = await resolveTenantId();
  const session = await getCurrentSession();
  const templates: AiPromptTemplate[] = session
    ? await listPromptTemplatesCached(tenantId, session.userId)
    : [];

  return (
    <AiPromptTemplatesShell
      templates={templates}
      isLoggedIn={session !== null}
    />
  );
}
