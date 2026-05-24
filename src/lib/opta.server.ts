import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { OptaMatch } from "./opta.scraper";

/** Läser senast synkade Opta-matcher från Supabase (kräver npm run sync:opta). */
export async function getCachedOptaMatches(): Promise<OptaMatch[]> {
  const { data, error } = await supabaseAdmin
    .from("opta_cache")
    .select("payload, fetched_at")
    .eq("cache_key", "livescores")
    .maybeSingle();

  if (error || !data?.payload) return [];
  const payload = data.payload as { matches?: OptaMatch[] };
  return payload.matches ?? [];
}
