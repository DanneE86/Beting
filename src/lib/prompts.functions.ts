import { createServerFn } from "@tanstack/react-start";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { LEAGUES } from "./fotmob.functions";

export async function getLeaguePromptText(leagueId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from("league_prompts")
    .select("prompt_text")
    .eq("league_id", leagueId)
    .maybeSingle();
  const txt = (data?.prompt_text ?? "").trim();
  return txt.length > 0 ? txt : null;
}

export const getLeaguePrompts = createServerFn({ method: "GET" })
  .handler(async () => {
    const { data } = await supabaseAdmin
      .from("league_prompts")
      .select("league_id, prompt_text, last_resolved_count, updated_at");
    const map = new Map((data ?? []).map((r) => [r.league_id, r]));
    return LEAGUES.map((lg) => {
      const r = map.get(lg.id);
      return {
        leagueId: lg.id,
        leagueName: lg.name,
        promptText: r?.prompt_text ?? "",
        lastResolvedCount: r?.last_resolved_count ?? 0,
        updatedAt: r?.updated_at ?? null,
      };
    });
  });

export const updateLeaguePrompt = createServerFn({ method: "POST" })
  .inputValidator((d: { leagueId: string; promptText: string }) => d)
  .handler(async ({ data }) => {
    const { error } = await supabaseAdmin
      .from("league_prompts")
      .upsert(
        {
          league_id: data.leagueId,
          prompt_text: data.promptText,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "league_id" },
      );
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// Analyserar resolverade tips per liga och uppdaterar prompten via AI om
// minst 20 nya resolverade matcher tillkommit sedan senaste uppdateringen.
export const analyzeAndUpdateLeaguePrompts = createServerFn({ method: "POST" })
  .handler(async () => {
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) return { updated: 0, skipped: 0, leagues: [] as any[] };

    const { data: existingRows } = await supabaseAdmin
      .from("league_prompts")
      .select("league_id, prompt_text, last_resolved_count");
    const existing = new Map(
      (existingRows ?? []).map((r) => [
        r.league_id,
        { promptText: r.prompt_text ?? "", lastCount: r.last_resolved_count ?? 0 },
      ]),
    );

    const results: { leagueId: string; leagueName: string; status: string; resolvedCount: number }[] = [];
    let updated = 0;
    let skipped = 0;

    for (const lg of LEAGUES) {
      const { count } = await supabaseAdmin
        .from("predictions")
        .select("id", { count: "exact", head: true })
        .eq("league_id", lg.id)
        .not("actual_outcome", "is", null);
      const resolvedCount = count ?? 0;
      const prev = existing.get(lg.id);
      const lastCount = prev?.lastCount ?? 0;
      const delta = resolvedCount - lastCount;
      if (delta < 20) {
        skipped++;
        results.push({ leagueId: lg.id, leagueName: lg.name, status: `väntar (${delta}/20 nya)`, resolvedCount });
        continue;
      }

      // Hämta senaste 60 resolverade tipsen för analys
      const { data: rows } = await supabaseAdmin
        .from("predictions")
        .select(
          "home_name, away_name, predicted_outcome, actual_outcome, home_win_pct, draw_pct, away_win_pct, confidence, actual_home_score, actual_away_score, predicted_score, postmortem",
        )
        .eq("league_id", lg.id)
        .not("actual_outcome", "is", null)
        .order("resolved_at", { ascending: false })
        .limit(60);

      const sample = (rows ?? []).map((r) => ({
        match: `${r.home_name} vs ${r.away_name}`,
        tipped: r.predicted_outcome,
        actual: r.actual_outcome,
        probs: `H${Math.round(r.home_win_pct)}/D${Math.round(r.draw_pct)}/A${Math.round(r.away_win_pct)}`,
        conf: r.confidence,
        predScore: r.predicted_score,
        actualScore:
          r.actual_home_score != null && r.actual_away_score != null
            ? `${r.actual_home_score}-${r.actual_away_score}`
            : null,
        lessons: (r.postmortem as any)?.lessons ?? null,
      }));

      const prevPrompt = (prev?.promptText ?? "").trim();

      const sys = `Du tränar en AI-tippmodell för en specifik fotbollsliga. Du får senaste resolverade tipsen för ligan (vad modellen tippade vs facit). Ditt jobb: skriv en KORT, SKARP träningsprompt (max 1500 tecken) på svenska som listar de viktigaste systematiska felen modellen gör i just DENNA liga, och konkreta regler för att rätta till dem. Skriv direkt instruktioner i imperativ ("Sätt drawPct minst...", "Var försiktig med...", "I derbyn mellan X och Y..."). Inga inledningar, inga rubrikfraser som "Här är". Bara regler.`;
      const userPrompt = `LIGA: ${lg.name}\nANTAL RESOLVERADE: ${resolvedCount}\n\nTIDIGARE TRÄNINGSPROMPT (förbättra/ersätt — behåll det som funkar):\n${prevPrompt || "(saknas)"}\n\nSENASTE TIPS MED FACIT:\n${JSON.stringify(sample, null, 2)}\n\nSkriv den uppdaterade träningsprompten.`;

      try {
        const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "google/gemini-2.5-flash",
            messages: [
              { role: "system", content: sys },
              { role: "user", content: userPrompt },
            ],
          }),
        });
        if (!res.ok) {
          results.push({ leagueId: lg.id, leagueName: lg.name, status: `AI-fel ${res.status}`, resolvedCount });
          continue;
        }
        const json: any = await res.json();
        const newPrompt: string = (json?.choices?.[0]?.message?.content ?? "").trim();
        if (!newPrompt) {
          results.push({ leagueId: lg.id, leagueName: lg.name, status: "tomt svar", resolvedCount });
          continue;
        }
        await supabaseAdmin.from("league_prompts").upsert(
          {
            league_id: lg.id,
            prompt_text: newPrompt,
            last_resolved_count: resolvedCount,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "league_id" },
        );
        updated++;
        results.push({ leagueId: lg.id, leagueName: lg.name, status: `uppdaterad (+${delta})`, resolvedCount });
      } catch (e: any) {
        results.push({ leagueId: lg.id, leagueName: lg.name, status: `fel: ${e.message}`, resolvedCount });
      }
    }

    return { updated, skipped, leagues: results };
  });
