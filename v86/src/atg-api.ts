import { ALLOWED_POOL_GAME_TYPES } from "./game-types";
import { resolvePrimaryDd, resolveV85ForNextSaturday, resolveV86ForNextWednesday } from "./v85-schedule";
import type { AtgGame, AtgRace, AtgStart, PoolGameType } from "./types";

const ATG_BASE = "https://www.atg.se/services/racinginfo/v1/api";

async function atgGet<T>(path: string): Promise<T> {
  const res = await fetch(`${ATG_BASE}${path}`, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`ATG ${res.status}: ${path}`);
  return res.json() as Promise<T>;
}

export async function fetchCalendarDay(date: string) {
  return atgGet<{ date: string; games: Record<string, { id: string }[]> }>(
    `/calendar/day/${date}`,
  );
}

export function findGameId(
  calendar: { games?: Record<string, { id: string }[]> },
  type: PoolGameType,
): string | null {
  const list = calendar.games?.[type];
  return list?.[0]?.id ?? null;
}

export async function fetchGame(gameId: string): Promise<AtgGame> {
  return atgGet<AtgGame>(`/games/${gameId}`);
}

export async function fetchRace(raceId: string): Promise<AtgRace> {
  return atgGet<AtgRace>(`/races/${raceId}`);
}

export async function resolveGame(
  date: string,
  preferred: PoolGameType = "V86",
): Promise<{ gameId: string; gameType: PoolGameType }> {
  if (preferred === "dd") {
    const dd = await resolvePrimaryDd(date);
    if (dd) return { gameId: dd.gameId, gameType: "dd" };
  }
  if (preferred === "V86") {
    const v86 = await resolveV86ForNextWednesday(date);
    if (v86) return { gameId: v86.gameId, gameType: "V86" };
  }
  if (preferred === "V85") {
    const v85 = await resolveV85ForNextSaturday(date);
    if (v85) return { gameId: v85.gameId, gameType: "V85" };
  }

  const cal = await fetchCalendarDay(date);
  const order: PoolGameType[] =
    preferred === "V86" ? ["V86", "V85", "dd"] : preferred === "V85" ? ["V85", "V86", "dd"] : ["dd", "V86", "V85"];
  for (const t of order) {
    const id = findGameId(cal, t);
    if (id) return { gameId: id, gameType: t };
  }
  throw new Error(`Inget V86, V85 eller Dagens Dubbel hittades för ${date}`);
}

export function activeStarts(race: AtgRace): AtgStart[] {
  return (race.starts ?? []).filter((s) => !s.scratched);
}

export function poolKey(gameType: PoolGameType): string {
  return gameType;
}

/** Spelprocent; för DD/V85/V86 utan pool används vinnarodds. */
export function betDistribution(start: AtgStart, gameType: PoolGameType): number {
  const p = start.pools?.[poolKey(gameType)];
  if (p?.betDistribution != null && p.betDistribution > 0) {
    return p.betDistribution / 100;
  }
  const odds = winOdds(start);
  if (odds != null && odds > 0) return 100 / odds;
  return 0;
}

export function winOdds(start: AtgStart): number | null {
  const raw = start.pools?.vinnare?.odds;
  if (raw == null) return null;
  return raw / 100;
}

export function listAllowedGamesFromCalendar(
  games: Record<string, unknown[]> | undefined,
): { type: PoolGameType; entries: { id: string; status?: string; startTime?: string; scheduledStartTime?: string; name?: string }[] }[] {
  if (!games) return [];
  return ALLOWED_POOL_GAME_TYPES.filter((type) => Array.isArray(games[type])).map(
    (type) => ({
      type,
      entries: games[type] as {
        id: string;
        status?: string;
        startTime?: string;
        scheduledStartTime?: string;
        name?: string;
      }[],
    }),
  );
}
