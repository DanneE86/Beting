/**
 * Verifierar att service role kan skriva till trav_predictions.
 * Kör: npx tsx scripts/test-trav-save.ts
 */
import { loadEnv } from "../src/lib/script-env";

loadEnv();

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

if (!url || !key) {
  console.error("Saknar SUPABASE_URL eller SUPABASE_SERVICE_ROLE_KEY i .env");
  process.exit(1);
}

if (key.startsWith("sb_publishable_")) {
  console.error("FEL: Du har publishable/anon-nyckel — använd service_role från Supabase Dashboard.");
  process.exit(1);
}

const { createClient } = await import("@supabase/supabase-js");
const admin = createClient(url, key, { auth: { persistSession: false } });

const { error: readErr } = await admin.from("trav_predictions").select("id", { head: true }).limit(1);
if (readErr) {
  console.error("Läsning trav_predictions FAIL:", readErr.message);
  console.error("\n→ Kör supabase/migrations/20260525080000_trav_prediction_history.sql i SQL Editor");
  process.exit(1);
}
console.log("Läsning trav_predictions: OK");

const testId = `test-${Date.now()}`;
const { data, error: insErr } = await admin
  .from("trav_predictions")
  .insert({
    game_id: testId,
    game_type: "dd",
    status: "pending",
    snapshot_json: { test: true },
    system_json: {},
    legs_json: [],
    meta_json: { source: "connectivity-test" },
  })
  .select("id")
  .single();

if (insErr) {
  console.error("Skrivning trav_predictions FAIL:", insErr.message);
  process.exit(1);
}

await admin.from("trav_predictions").delete().eq("id", data.id);
console.log("Skrivning + radering trav_predictions: OK");
console.log("\nSamma nyckel ska ligga i Cloudflare:");
console.log("  npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY");
