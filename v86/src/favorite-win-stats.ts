import { activeStarts, betDistribution, fetchCalendarDay, fetchGame, listAllowedGamesFromCalendar } from "./atg-api";
import { ALLOWED_POOL_GAME_TYPES } from "./game-types";
import type { AtgRace, AtgStart, PoolGameType } from "./types";

export type FavoriteWinBucketKey =
  | "20-30%"
  | "31-40%"
  | "41-50%"
  | "51-60%"
  | "61-70%"
  | "71-80%"
  | "81-100%";

export const FAVORITE_WIN_BUCKETS: {
  key: FavoriteWinBucketKey;
  min: number;
  max: number;
  sortOrder: number;
}[] = [
  { key: "20-30%", min: 20, max: 30, sortOrder: 1 },
  { key: "31-40%", min: 31, max: 40, sortOrder: 2 },
  { key: "41-50%", min: 41, max: 50, sortOrder: 3 },
  { key: "51-60%", min: 51, max: 60, sortOrder: 4 },
  { key: "61-70%", min: 61, max: 70, sortOrder: 5 },
  { key: "71-80%", min: 71, max: 80, sortOrder: 6 },
  { key: "81-100%", min: 81, max: 100, sortOrder: 7 },
];

export type FavoriteWinBucketStat = {
  bucketKey: FavoriteWinBucketKey;
  streckMin: number;
  streckMax: number;
  sortOrder: number;
  raceCount: number;
  favoriteWins: number;
  winPct: number;
};

export type FavoriteWinStatsResult = {
  reportKey: string;
  fromDate: string;
  toDate: string;
  lookbackDays: number;
  gameTypes: PoolGameType[];
  racesInBuckets: number;
  favoriteWins: number;
  winPct: number;
  racesSkippedOutsideBuckets: number;
  buckets: FavoriteWinBucketStat[];
};

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function dateRangeDescending(days: number): string[] {
  const out: string[] = [];
  const end = new Date();
  for (let i = 0; i < days; i++) {
    const d = new Date(end);
    d.setUTCDate(d.getUTCDate() - i);
    out.push(formatDate(d));
  }
  return out;
}

function winnerNumbers(race: AtgRace, gameType: PoolGameType): number[] {
  const poolWinners = race.pools?.[gameType]?.result?.winners;
  if (Array.isArray(poolWinners)) {
    if (poolWinners.every((w) => typeof w === "number")) {
      return poolWinners as number[];
    }
    return poolWinners.flatMap((item) =>
      typeof item === "object" && item && "combination" in item
        ? (((item as { combination?: number[] }).combination ?? []).filter(
            (n) => typeof n === "number",
          ) as number[])
        : [],
    );
  }
  return activeStarts(race)
    .filter((s) => s.result?.finishOrder === 1 || s.result?.place === 1)
    .map((s) => s.number);
}

function pickFavorite(starts: AtgStart[], gameType: PoolGameType): AtgStart | null {
  let best: AtgStart | null = null;
  let bestBd = -1;
  for (const start of starts) {
    const bd = betDistribution(start, gameType);
    if (bd > bestBd) {
      bestBd = bd;
      best = start;
    }
  }
  return best;
}

function bucketForPct(pct: number): FavoriteWinBucketKey | null {
  for (const b of FAVORITE_WIN_BUCKETS) {
    if (pct >= b.min && pct <= b.max) return b.key;
  }
  return null;
}

function roundPct(wins: number, races: number): number {
  return races > 0 ? Math.round((wins / races) * 1000) / 10 : 0;
}

export async function computeFavoriteWinStats(
  lookbackDays = 365,
  reportKey = `rolling-${lookbackDays}d`,
): Promise<FavoriteWinStatsResult> {
  const stats = new Map<FavoriteWinBucketKey, { races: number; wins: number }>();
  for (const b of FAVORITE_WIN_BUCKETS) stats.set(b.key, { races: 0, wins: 0 });

  let racesSkippedOutsideBuckets = 0;
  const seenRaceIds = new Set<string>();
  const dates = dateRangeDescending(lookbackDays);
  const fromDate = dates[dates.length - 1]!;
  const toDate = dates[0]!;

  for (const date of dates) {
    const calendar = await fetchCalendarDay(date).catch(() => null);
    if (!calendar?.games) continue;

    for (const { type: gameType, entries } of listAllowedGamesFromCalendar(calendar.games)) {
      for (const entry of entries) {
        const game = await fetchGame(entry.id).catch(() => null);
        if (!game || game.status !== "results") continue;

        for (const race of game.races ?? []) {
          if (seenRaceIds.has(race.id)) continue;
          seenRaceIds.add(race.id);

          const starts = activeStarts(race);
          if (starts.length < 2) continue;

          const favorite = pickFavorite(starts, gameType);
          if (!favorite) continue;

          const favBd = betDistribution(favorite, gameType);
          const bucket = bucketForPct(favBd);
          if (!bucket) {
            racesSkippedOutsideBuckets++;
            continue;
          }

          const winners = winnerNumbers(race, gameType);
          if (winners.length === 0) continue;

          const row = stats.get(bucket)!;
          row.races++;
          if (winners.includes(favorite.number)) row.wins++;
        }
      }
    }
  }

  const buckets: FavoriteWinBucketStat[] = FAVORITE_WIN_BUCKETS.map((b) => {
    const { races, wins } = stats.get(b.key)!;
    return {
      bucketKey: b.key,
      streckMin: b.min,
      streckMax: b.max,
      sortOrder: b.sortOrder,
      raceCount: races,
      favoriteWins: wins,
      winPct: roundPct(wins, races),
    };
  });

  const racesInBuckets = buckets.reduce((s, b) => s + b.raceCount, 0);
  const favoriteWins = buckets.reduce((s, b) => s + b.favoriteWins, 0);

  return {
    reportKey,
    fromDate,
    toDate,
    lookbackDays,
    gameTypes: [...ALLOWED_POOL_GAME_TYPES],
    racesInBuckets,
    favoriteWins,
    winPct: roundPct(favoriteWins, racesInBuckets),
    racesSkippedOutsideBuckets,
    buckets,
  };
}
