/** Ligas som följer kalenderår (jan–dec) istället för aug–jun. */
export const CALENDAR_YEAR_LEAGUES = new Set<string>([
  "swe.1",
  "swe.2",
  "nor.1",
  "fin.1",
  "isl.1",
  "bra.1",
  "arg.1",
  "chi.1",
  "usa.1",
  "mex.1",
  "can.1",
  "jpn.1",
  "kor.1",
  "aus.1",
  "fifa.world",
  "conmebol.libertadores",
  "conmebol.sudamericana",
]);

export function seasonLabelForDate(leagueId: string, date: Date): string {
  const y = date.getUTCFullYear();
  if (CALENDAR_YEAR_LEAGUES.has(leagueId)) return String(y);
  const m = date.getUTCMonth() + 1;
  return m >= 7 ? `${y}-${y + 1}` : `${y - 1}-${y}`;
}

export function currentSeasonLabel(leagueId: string): string {
  return seasonLabelForDate(leagueId, new Date());
}

/** YYYYMMDD-intervall för en säsongsetikett. */
export function seasonDateRange(
  leagueId: string,
  season: string,
  anchorYear: number,
): { fromYmd: string; toYmd: string } {
  const isCal = CALENDAR_YEAR_LEAGUES.has(leagueId);
  let fromY: number;
  let fromM: number;
  let toY: number;
  let toM: number;

  if (isCal) {
    fromY = anchorYear;
    fromM = 1;
    toY = anchorYear;
    toM = 12;
  } else {
    const [a, b] = season.split("-").map(Number);
    fromY = a;
    fromM = 7;
    toY = b;
    toM = 6;
  }

  const fromYmd = `${fromY}${String(fromM).padStart(2, "0")}01`;
  const lastDay = new Date(Date.UTC(toY, toM, 0)).getUTCDate();
  const toYmd = `${toY}${String(toM).padStart(2, "0")}${String(lastDay).padStart(2, "0")}`;
  return { fromYmd, toYmd };
}
