import { parseEventRound, parseEventTeams } from "./espn.parsers";
import { outcomeFromScore } from "./match-outcome";

export type ArchiveSeasonRow = {
  league_id: string;
  season: string;
  event_id: string;
  event_date: string;
  home_id: string;
  away_id: string;
  home_name: string;
  away_name: string;
  home_score: number;
  away_score: number;
  outcome: string;
  btts: boolean;
  round: number | null;
  raw: null;
};

/** Konvertera ESPN scoreboard-events till archived_seasons-rader. */
export function eventsToArchiveRows(
  events: unknown[],
  leagueId: string,
  season: string,
): ArchiveSeasonRow[] {
  const rows: ArchiveSeasonRow[] = [];
  for (const raw of events) {
    const e = raw as {
      id?: string;
      date?: string;
      status?: { type?: { state?: string } };
    };
    if (e.status?.type?.state !== "post") continue;
    const teams = parseEventTeams(e as Parameters<typeof parseEventTeams>[0]);
    if (!teams) continue;
    const hs = teams.homeScore;
    const as = teams.awayScore;
    if (hs == null || as == null) continue;
    const outcome = outcomeFromScore(hs, as);
    if (!outcome) continue;
    rows.push({
      league_id: leagueId,
      season,
      event_id: String(e.id),
      event_date: e.date ?? "",
      home_id: teams.homeId,
      away_id: teams.awayId,
      home_name: teams.homeName,
      away_name: teams.awayName,
      home_score: hs,
      away_score: as,
      outcome,
      btts: hs > 0 && as > 0,
      round: parseEventRound(e as Parameters<typeof parseEventRound>[0]),
      raw: null,
    });
  }
  return rows;
}
