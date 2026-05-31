import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type PlayerImportanceRow = {
  athlete_id: string;
  athlete_name: string;
  importance_score: number;
  starts: number;
  goals: number;
  assists: number;
  appearances: number;
};

/**
 * Hämtar lagets viktigaste spelare från football_player_season_stats.
 * Används för att förstärka absence-scoring när startelvan är bekräftad.
 */
export async function getTeamImportancePlayers(
  leagueId: string,
  season: string,
  teamId: string,
  limit = 15,
): Promise<PlayerImportanceRow[]> {
  const { data } = await (supabaseAdmin as ReturnType<typeof import("@supabase/supabase-js").createClient>)
    .from("football_player_season_stats")
    .select("athlete_id, athlete_name, importance_score, starts, goals, assists, appearances")
    .eq("league_id", leagueId)
    .eq("season", season)
    .eq("team_id", teamId)
    .gte("starts", 3)
    .order("importance_score", { ascending: false })
    .limit(limit);
  return ((data ?? []) as unknown) as PlayerImportanceRow[];
}

/**
 * Matchar spelarnamn mot bekräftad startelva (normaliserad textjämförelse).
 * Returnerar importance_score för de spelare som SAKNAS i startelvan.
 *
 * Logik:
 * - Hämta lagets top-spelare från DB (importance_score, starts)
 * - Filtrera bort de som är i confirmedXI eller på bänken
 * - Returnera de saknade spelarna med deras importance-poäng
 */
export function findMissingImportancePlayers(
  dbPlayers: PlayerImportanceRow[],
  confirmedStartingXI: string[],
  bench: string[],
): Array<{ name: string; importance_score: number; starts: number }> {
  if (!confirmedStartingXI.length || !dbPlayers.length) return [];

  const normalize = (s: string) =>
    s
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]/g, "");

  const presentNames = new Set([
    ...confirmedStartingXI.map(normalize),
    ...bench.map(normalize),
  ]);

  // En spelare räknas som "förväntad starter" om de har starts >= 5 eller importance_score > 25
  const expectedStarters = dbPlayers.filter(
    (p) => p.starts >= 5 || p.importance_score > 25,
  );

  return expectedStarters
    .filter((p) => {
      const norm = normalize(p.athlete_name);
      const nameParts = norm.split(/\s+/);
      return !Array.from(presentNames).some((present) =>
        nameParts.some((part) => part.length >= 4 && present.includes(part)),
      );
    })
    .map((p) => ({
      name: p.athlete_name,
      importance_score: p.importance_score,
      starts: p.starts,
      goals: p.goals,
      assists: p.assists,
    }));
}

/**
 * Beräknar ett extra absence-tillägg baserat på vilka viktiga spelare
 * som saknas i den bekräftade startelvan.
 *
 * Formel: (importance_score / 60) * 0.18 extra mål-reduktion per saknad spelare
 * Capped per spelare för att inte ta bort för mycket.
 *
 * Returnerar:
 * - extraGoalPenalty: extra mål att subtrahera från lagets attack
 * - bttsPenaltyPp: procentenheter att subtrahera från BTTS-sannolikhet
 * - missingKeyPlayers: lista med saknade spelare och deras impact
 */
export function calcImportanceAbsencePenalty(
  missing: Array<{ name: string; importance_score: number; starts: number; goals?: number; assists?: number }>,
  leagueId: string,
): {
  extraGoalPenalty: number;
  extraGoalDefensePenalty: number;
  bttsPenaltyPp: number;
  missingKeyPlayers: Array<{ name: string; importance_score: number; goalImpact: number }>;
} {
  if (!missing.length) {
    return { extraGoalPenalty: 0, extraGoalDefensePenalty: 0, bttsPenaltyPp: 0, missingKeyPlayers: [] };
  }

  // Liga-specifika skalor baserade på vår analys:
  // - PL (eng.1): lägre impact per spelare (djupare squads)
  // - La Liga (esp.1): medel impact
  // - Bundesliga: medel-hög impact
  // - Serie A: medel impact
  // - Ligue 1: medel impact
  // - Allsvenskan: högre impact per spelare
  const leagueScales: Record<string, number> = {
    "eng.1": 0.80,
    "esp.1": 1.00,
    "ger.1": 0.90,
    "ita.1": 0.90,
    "fra.1": 0.85,
    "swe.1": 1.20,
    "nor.1": 1.15,
    "sco.1": 1.10,
    "bra.1": 1.05,
    "arg.1": 1.05,
  };
  const scale = leagueScales[leagueId] ?? 1.0;

  let totalAttackPenalty = 0;
  let totalDefensePenalty = 0;
  let totalBttsPp = 0;
  const missingKeyPlayers: Array<{ name: string; importance_score: number; goalImpact: number }> = [];

  for (const p of missing) {
    if (p.importance_score < 20) continue;

    const rawImpact = (p.importance_score / 60) * 0.18 * scale;
    const capped = Math.min(rawImpact, 0.35);

    // Positions-heuristik baserad på mål/assists:
    // Spelare med goals≥2 eller assists≥3 → offensiv profil (80% attack, 20% defense)
    // Övriga → defensiv profil (20% attack, 80% defense) — troligtvis back/GK/DM
    const isOffensive = (p.goals ?? 0) >= 2 || (p.assists ?? 0) >= 3;
    const atkShare = isOffensive ? 0.80 : 0.20;
    const defShare = 1 - atkShare;

    totalAttackPenalty += capped * atkShare;
    totalDefensePenalty += capped * defShare;
    totalBttsPp += capped * 20;

    if (capped >= 0.05) {
      missingKeyPlayers.push({
        name: p.name,
        importance_score: p.importance_score,
        goalImpact: Math.round(capped * 100) / 100,
      });
    }
  }

  const cappedAtk = Math.min(totalAttackPenalty, 0.40);
  const cappedDef = Math.min(totalDefensePenalty, 0.30);
  const cappedBtts = Math.min(totalBttsPp, 12);

  return {
    extraGoalPenalty: Math.round(cappedAtk * 100) / 100,
    extraGoalDefensePenalty: Math.round(cappedDef * 100) / 100,
    bttsPenaltyPp: Math.round(cappedBtts * 10) / 10,
    missingKeyPlayers,
  };
}
