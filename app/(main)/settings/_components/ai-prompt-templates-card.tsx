import { getCurrentSession } from "@/lib/supabase/server";
import { repos } from "@/lib/repositories";
import { AiPromptTemplatesShell } from "./ai-prompt-template-dialog";
import type { AiPromptTemplate } from "@/types/ai-prompt-template";

export async function AiPromptTemplatesCard() {
  const session = await getCurrentSession();
  const templates: AiPromptTemplate[] = session
    ? await repos.promptTemplate.list(session.userId)
    : [];

  return (
    <AiPromptTemplatesShell
      templates={templates}
      isLoggedIn={session !== null}
    />
  );
}
