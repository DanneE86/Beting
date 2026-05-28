import { supabaseAdmin } from "../src/integrations/supabase/client.server";

const RULE5_PROMPT = `Regel 5: Målstyrd plusstrategi.
- Prioritera stabil månadsavkastning.
- Sträva efter minst +10 000 kr per månad över tid.
- Behåll tydlig exponering mot högutdelning (>100k och miljonutfall) när datan stödjer det.
- Undvik överaggressiv spikning i osäkra lopp.`;

const RULE6_PROMPT = `Regel 6: Förbättrad plusstrategi (utvecklad från Regel 5).
- Optimera för bättre balans mellan månadsstabilitet och topputdelning.
- Prioritera robust träffprofil i öppna lopp.
- Behåll potential för >100k och miljonutfall utan att förstöra månadsnetto.
- Välj budget/utdelningsmål adaptivt efter loppöppenhet.`;

async function upsertScope(scope: string, promptText: string) {
  const { error } = await supabaseAdmin.from("trav_learning_prompts").upsert(
    {
      game_type: scope,
      prompt_text: promptText,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "game_type" },
  );
  if (error) throw new Error(`${scope}: ${error.message}`);
}

async function main() {
  const scopes = ["trav:V85", "trav:V86", "trav:dd"];
  for (const base of scopes) {
    await upsertScope(`${base}:rule5`, RULE5_PROMPT);
    await upsertScope(`${base}:rule6`, RULE6_PROMPT);
  }
  console.log("Sparade rule5/rule6-prompts i trav_learning_prompts.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
