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

export async function getTravsportManyFromDb(
  horseIds: number[],
): Promise<Record<number, TravsportHorseProfile>> {
  if (horseIds.length === 0) return {};
  const { data, error } = await supabaseAdmin
    .from("trav_horse_cache")
    .select("horse_id, payload")
    .in("horse_id", horseIds);
  if (error || !data) return {};
  return Object.fromEntries(
    data.flatMap((row) => {
      const horseId = Number(row.horse_id);
      if (!Number.isFinite(horseId)) return [];
      return [[horseId, row.payload as TravsportHorseProfile] as const];
    }),
  );
}

export async function saveTravsportToDb(profile: TravsportHorseProfile): Promise<void> {
  const { error } = await supabaseAdmin.from("trav_horse_cache").upsert({
    horse_id: profile.horseId,
    payload: profile,
    fetched_at: profile.fetchedAt,
  });
  if (error) console.warn("trav_horse_cache upsert", error.message);
}
