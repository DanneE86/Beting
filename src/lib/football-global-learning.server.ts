import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { updateModelPrompt } from "./model-prompts.server";

type ArchivedSampleRow = {
  league_id: string;
  home_name: string;
  away_name: string;
  home_score: number | null;
  away_score: number | null;
  outcome: string | null;
  btts: boolean | null;
  event_date: string | null;
};

function pct(numerator: number, denominator: number) {
  if (!denominator) return 0;
  return Math.round((numerator / denominator) * 1000) / 10;
}

function topByFrequency(items: string[], limit = 6) {
  const counts = new Map<string, number>();
  for (const item of items) {
    const text = item.trim();
    if (!text) continue;
    counts.set(text, (counts.get(text) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([text, count]) => (count > 1 ? `${text} (×${count})` : text));
}

function fallbackPromptFromSample(
  sample: ArchivedSampleRow[],
  resolvedLessons: string[],
  topSignalsMissed: string[],
  topModelMistakes: string[],
) {
  let homeWins = 0;
  let draws = 0;
  let awayWins = 0;
  let bttsYes = 0;
  let goals = 0;
  let lowScoring = 0;
  let matches = 0;

  for (const row of sample) {
    if (row.outcome === "1") homeWins++;
    else if (row.outcome === "X") draws++;
    else if (row.outcome === "2") awayWins++;
    if (row.btts) bttsYes++;
    if (row.home_score != null && row.away_score != null) {
      const totalGoals = Number(row.home_score) + Number(row.away_score);
      goals += totalGoals;
      if (totalGoals <= 2) lowScoring++;
      matches++;
    }
  }

  const lines = [
    `Håll drawPct realistisk när lagen är jämna; i senaste samplet slutade ${pct(draws, sample.length)}% oavgjort.`,
    `Överdriv inte hemmalaget utan tydlig edge; hemmasegrar låg på ${pct(homeWins, sample.length)}% medan bortasegrar låg på ${pct(awayWins, sample.length)}%.`,
    `Kalibrera målbilden konservativt när ligadata pekar lågt; ${pct(lowScoring, matches)}% av matcherna stannade på högst två mål och BTTS låg på ${pct(bttsYes, sample.length)}%.`,
    `Låt ligaspecifik prompt styra före global prompt när de krockar.`,
    ...(topSignalsMissed[0]
      ? [`Väg återkommande missade signaler tungt: ${topSignalsMissed.slice(0, 2).join("; ")}.`]
      : []),
    ...(topModelMistakes[0]
      ? [`Undvik återkommande modellfel: ${topModelMistakes.slice(0, 2).join("; ")}.`]
      : []),
    ...resolvedLessons.slice(0, 3),
  ];
  return topByFrequency(lines, 5).map((line) => `- ${line}`).join("\n");
}

export async function updateGlobalFootballPromptFromLatestMatches(sampleSize = 500) {
  const apiKey = process.env.LOVABLE_API_KEY;
  const { data: sampleRows, error } = await supabaseAdmin
    .from("archived_seasons")
    .select("league_id, home_name, away_name, home_score, away_score, outcome, btts, event_date")
    .not("outcome", "is", null)
    .order("event_date", { ascending: false })
    .limit(sampleSize);
  if (error) throw new Error(error.message);

  const sample = (sampleRows ?? []) as ArchivedSampleRow[];
  if (sample.length === 0) {
    throw new Error("Inga arkiverade fotbollsmatcher hittades");
  }

  const { data: resolvedPredictions } = await supabaseAdmin
    .from("predictions")
    .select(
      "league_id, home_name, away_name, predicted_outcome, actual_outcome, home_win_pct, draw_pct, away_win_pct, key_factors, postmortem, resolved_at",
    )
    .not("actual_outcome", "is", null)
    .order("resolved_at", { ascending: false })
    .limit(120);

  const resolvedLessons = topByFrequency(
    (resolvedPredictions ?? []).flatMap((row) =>
      Array.isArray((row.postmortem as { lessons?: string[] } | null)?.lessons)
        ? ((row.postmortem as { lessons?: string[] }).lessons ?? [])
        : [],
    ),
    8,
  );
  const topSignalsMissed = topByFrequency(
    (resolvedPredictions ?? []).flatMap((row) =>
      Array.isArray((row.postmortem as { signals_missed?: string[] } | null)?.signals_missed)
        ? ((row.postmortem as { signals_missed?: string[] }).signals_missed ?? [])
        : [],
    ),
    8,
  );
  const topModelMistakes = topByFrequency(
    (resolvedPredictions ?? []).flatMap((row) =>
      Array.isArray((row.postmortem as { model_mistakes?: string[] } | null)?.model_mistakes)
        ? ((row.postmortem as { model_mistakes?: string[] }).model_mistakes ?? [])
        : [],
    ),
    8,
  );

  const leagueSummary = [...sample.reduce((map, row) => {
    const current =
      map.get(row.league_id) ??
      { matches: 0, homeWins: 0, draws: 0, awayWins: 0, btts: 0, goals: 0 };
    current.matches++;
    if (row.outcome === "1") current.homeWins++;
    else if (row.outcome === "X") current.draws++;
    else if (row.outcome === "2") current.awayWins++;
    if (row.btts) current.btts++;
    if (row.home_score != null && row.away_score != null) {
      current.goals += Number(row.home_score) + Number(row.away_score);
    }
    map.set(row.league_id, current);
    return map;
  }, new Map<string, { matches: number; homeWins: number; draws: number; awayWins: number; btts: number; goals: number }>())]
    .sort((a, b) => b[1].matches - a[1].matches)
    .slice(0, 12)
    .map(([leagueId, stats]) => ({
      leagueId,
      matches: stats.matches,
      homeWinPct: pct(stats.homeWins, stats.matches),
      drawPct: pct(stats.draws, stats.matches),
      awayWinPct: pct(stats.awayWins, stats.matches),
      bttsPct: pct(stats.btts, stats.matches),
      avgGoals: Math.round((stats.goals / Math.max(1, stats.matches)) * 100) / 100,
    }));

  let promptText = fallbackPromptFromSample(
    sample,
    resolvedLessons,
    topSignalsMissed,
    topModelMistakes,
  );

  if (apiKey) {
    const system = `Du tränar en global fotbollsmodell. Du får de senaste 500 fotbollsmatcherna från arkivet plus verkliga lärdomar från resolverade prediction-postmortems.
Skriv en kort svensk GLOBAL träningsprompt (max 1500 tecken) som:
- bara innehåller konkreta regler i imperativ
- fokuserar på kalibrering, draw-realism, mål/BTTS, hemma/borta-bias och när modellen ska vara försiktig
- väver in återkommande missade signaler från resolverade postmortems (skador, lineups, domare, marknad om de återkommer i datan)
- fungerar globalt över ligor
- uttryckligen säger att ligaspecifika prompts väger tyngre när de finns.
Ingen inledning. Bara regler.`;

    const user = JSON.stringify(
      {
        sampleSize: sample.length,
        latestMatches: sample.slice(0, 80),
        leagueSummary,
        resolvedPredictionLessons: resolvedLessons,
        topSignalsMissed,
        topModelMistakes,
      },
      null,
      2,
    );

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
            { role: "system", content: system },
            { role: "user", content: user },
          ],
        }),
      });
      if (res.ok) {
        const json: any = await res.json();
        const candidate = String(json?.choices?.[0]?.message?.content ?? "").trim();
        if (candidate) promptText = candidate;
      }
    } catch {
      // fallback prompt already set
    }
  }

  await updateModelPrompt({
    scope: "football-global",
    promptText,
    lastSampleCount: sample.length,
  });

  return {
    scope: "football-global",
    sampleCount: sample.length,
    promptText,
    leagueSummary,
    resolvedPredictionLessons: resolvedLessons,
    topSignalsMissed,
    topModelMistakes,
  };
}

