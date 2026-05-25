import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { TravsportHorseProfile } from "../../v86/src/travsport/types";

export async function getTravsportFromDb(horseId: number): Promise<TravsportHorseProfile | null> {
  const { data, error } = await supabaseAdmin
    .from("trav_horse_cache")
    .select("payload, fetched_at")
    .eq("horse_id", horseId)
    .maybeSingle();
  if (error || !data) return null;
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
