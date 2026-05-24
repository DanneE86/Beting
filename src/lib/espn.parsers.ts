export type EspnCompetitor = {
  homeAway?: string;
  score?: string | number;
  team?: { id?: string; displayName?: string };
};

export type EspnEventTeams = {
  homeId: string;
  awayId: string;
  homeName: string;
  awayName: string;
  homeScore: number | null;
  awayScore: number | null;
};

export function parseEventTeams(event: {
  competitions?: { competitors?: EspnCompetitor[] }[];
}): EspnEventTeams | null {
  const comp = event.competitions?.[0];
  const home = comp?.competitors?.find((c) => c.homeAway === "home");
  const away = comp?.competitors?.find((c) => c.homeAway === "away");
  const homeId = String(home?.team?.id ?? "");
  const awayId = String(away?.team?.id ?? "");
  const homeName = home?.team?.displayName ?? "";
  const awayName = away?.team?.displayName ?? "";
  if (!homeId || !awayId || !homeName || !awayName) return null;
  const homeScore = home?.score != null ? Number(home.score) : null;
  const awayScore = away?.score != null ? Number(away.score) : null;
  return { homeId, awayId, homeName, awayName, homeScore, awayScore };
}

export function parseEventRound(event: {
  week?: { number?: number };
  season?: { week?: number };
}): number | null {
  return event.week?.number ?? event.season?.week ?? null;
}
