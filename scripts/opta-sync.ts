/**
 * Synkar Opta livescores till Supabase (opta_cache).
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { resolve } from "path";
import { fetchOptaLiveScores } from "../src/lib/opta.scraper.js";

function loadEnv() {
  for (const line of readFileSync(resolve(".env"), "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    process.env[t.slice(0, i).trim()] ??= t.slice(i + 1).trim();
  }
}
loadEnv();

const data = await fetchOptaLiveScores({ headed: true });

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});

const { error } = await supabase.from("opta_cache").upsert(
  {
    cache_key: "livescores",
    payload: data,
    fetched_at: data.fetchedAt,
  },
  { onConflict: "cache_key" },
);

if (error) {
  if (error.message.includes("opta_cache")) {
    console.error("Tabellen opta_cache saknas. Kör SQL: supabase/migrations/20260524100000_opta_cache.sql");
  } else {
    console.error(error.message);
  }
  process.exit(1);
}

console.log(`Synkade ${data.matches.length} Opta-matcher till Supabase`);
for (const m of data.matches.slice(0, 5)) {
  console.log(`  ${m.leagueName}: ${m.homeName} vs ${m.awayName} (${m.status})`);
}
