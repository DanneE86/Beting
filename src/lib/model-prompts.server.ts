import { supabaseAdmin } from "@/integrations/supabase/client.server";

function isMissingTableError(error: { code?: string; message?: string } | null | undefined, table: string) {
  return Boolean(
    error &&
      (error.code === "PGRST205" ||
        error.message?.includes(table) ||
        error.message?.includes("schema cache")),
  );
}

export async function getModelPromptText(scope: string): Promise<string | null> {
  const primary = await supabaseAdmin
    .from("model_learning_prompts")
    .select("prompt_text")
    .eq("scope", scope)
    .maybeSingle();
  if (primary.data) {
    const text = String(primary.data.prompt_text ?? "").trim();
    return text.length > 0 ? text : null;
  }
  if (!isMissingTableError(primary.error, "model_learning_prompts")) return null;

  const fallback = await supabaseAdmin
    .from("trav_learning_prompts")
    .select("prompt_text")
    .eq("game_type", scope)
    .maybeSingle();
  const text = String(fallback.data?.prompt_text ?? "").trim();
  return text.length > 0 ? text : null;
}

export async function updateModelPrompt(input: {
  scope: string;
  promptText: string;
  lastSampleCount: number;
}) {
  const primary = await supabaseAdmin
    .from("model_learning_prompts")
    .upsert(
      {
        scope: input.scope,
        prompt_text: input.promptText,
        last_sample_count: input.lastSampleCount,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "scope" },
    );
  if (!primary.error) return { ok: true };
  if (!isMissingTableError(primary.error, "model_learning_prompts")) {
    throw new Error(primary.error.message);
  }

  const fallback = await supabaseAdmin
    .from("trav_learning_prompts")
    .upsert(
      {
        game_type: input.scope,
        prompt_text: input.promptText,
        last_resolved_count: input.lastSampleCount,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "game_type" },
    );
  if (fallback.error) throw new Error(fallback.error.message);
  return { ok: true };
}

