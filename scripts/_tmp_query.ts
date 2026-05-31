import { loadEnv } from "../src/lib/script-env";
loadEnv();
import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

// Kolla football_match_intel för Man United PL matcher
const { data } = await sb
  .from("football_match_intel")
  .select("event_date, home_name, away_name, home_score, away_score, league_id, season")
  .or("home_name.ilike.%Manchester United%,away_name.ilike.%Manchester United%")
  .eq("league_id", "eng.1")
  .order("event_date", { ascending: false })
  .limit(5);

console.log("Man United matcher i databasen:", data?.length ?? 0);
data?.forEach(m => console.log(`${m.event_date?.slice(0,10)} ${m.home_name} ${m.home_score}-${m.away_score} ${m.away_name} (${m.league_id} ${m.season})`));
