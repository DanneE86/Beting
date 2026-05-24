import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { TravsportHorseProfile } from "../../v86/src/travsport/types";

const MAX_AGE_MS = 6 * 60 * 60 * 1000;

export async function getTravsportFromDb(horseId: number): Promise<TravsportHorseProfile | null> {
  const { data, error } = await supabaseAdmin
    .from("trav_horse_cache")
    .select("payload, fetched_at")
    .eq("horse_id", horseId)
    .maybeSingle();
  if (error || !data) return null;
  const age = Date.now() - new Date(data.fetched_at).getTime();
  if (age > MAX_AGE_MS) return null;
  return data.payload as TravsportHorseProfile;
}

export async function saveTravsportToDb(profile: TravsportHorseProfile): Promise<void> {
  const { error } = await supabaseAdmin.from("trav_horse_cache").upsert({
    horse_id: profile.horseId,
    payload: profile,
    fetched_at: profile.fetchedAt,
  });
  if (error) console.warn("trav_horse_cache upsert", error.message);
}
