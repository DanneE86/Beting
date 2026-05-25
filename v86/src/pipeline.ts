import { fetchAndelShares } from "./andelsspel";
import {
  fetchCalendarDay,
  fetchGame,
  listAllowedGamesFromCalendar,
  resolveGame,
} from "./atg-api";
import { defaultBudgetKr, defaultMinPayoutKr, gameTypeLabel } from "./game-types";
import { analyzeGame, pickBestSkrellLeg } from "./analyze";
import { buildSystem } from "./system-builder";
import { fetchTravsportForGame } from "./travsport/fetch-game";
import {
  collectUpcomingV86,
  collectUpcomingV85,
  isWednesdayStart,
  isSaturdayStart,
  weekdayFromIso,
} from "./v85-schedule";
import type { AtgGame, AtgRace, AtgStart, FetchSnapshot, PoolGameType } from "./types";

export interface PipelineInput {
  date?: string;
  gameId?: string;
  budgetKr?: number;
  targetMinPayoutKr?: number;
  includeAndelsspel?: boolean;
  includeTravsport?: boolean;
  travsportDbCache?: import("./travsport/fetch-game").FetchGameTravsportOptions["dbCache"];
}

export interface GameOption {
  id: string;
  type: PoolGameType;
  typeLabel: string;
  status: string;
  startTime?: string;
  trackNames?: string;
  startLabel?: string;
  isUpcoming?: boolean;
  isSaturdayRound?: boolean;
  isWednesdayRound?: boolean;
}

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

const WEEKDAY_SV = ["sön", "mån", "tis", "ons", "tors", "fre", "lör"] as const;

function formatStartLabel(iso?: string): string | undefined {
  if (!iso) return undefined;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return undefined;
  const wd = WEEKDAY_SV[d.getDay()];
  return `${wd} ${d.getDate()} ${d.toLocaleString("sv-SE", { month: "short" })}`;
}

export async function listGamesForDate(date: string): Promise<GameOption[]> {
  const cal = await fetchCalendarDay(date);
  const out: GameOption[] = [];
  const seen = new Set<string>();

  const push = (opt: GameOption) => {
    if (seen.has(opt.id)) return;
    seen.add(opt.id);
    out.push(opt);
  };

  for (const { type, entries } of listAllowedGamesFromCalendar(cal.games)) {
    for (const g of entries) {
      const start = g.startTime ?? g.scheduledStartTime;
      push({
        id: g.id,
        type,
        typeLabel: gameTypeLabel(type),
        status: g.status ?? "unknown",
        startTime: start,
        trackNames: g.name,
        startLabel: formatStartLabel(start),
        isSaturdayRound: type === "V85" ? isSaturdayStart(start) : false,
      });
    }
  }

  const upcomingV85 = await collectUpcomingV85(date);
  for (const u of upcomingV85) {
    push({
      id: u.entry.id,
      type: "V85",
      typeLabel: u.isSaturday ? "V85 (lördag)" : "V85",
      status: u.entry.status ?? "upcoming",
      startTime: u.startIso,
      trackNames: u.entry.name,
      startLabel: formatStartLabel(u.startIso),
      isUpcoming: u.calendarDate !== date,
      isSaturdayRound: u.isSaturday,
    });
  }

  const upcomingV86 = await collectUpcomingV86(date);
  for (const u of upcomingV86) {
    push({
      id: u.entry.id,
      type: "V86",
      typeLabel: u.isWednesday ? "V86 (onsdag)" : "V86",
      status: u.entry.status ?? "upcoming",
      startTime: u.startIso,
      trackNames: u.entry.name,
      startLabel: formatStartLabel(u.startIso),
      isUpcoming: u.calendarDate !== date,
      isWednesdayRound: u.isWednesday,
    });
  }

  out.sort((a, b) => {
    const byStart = (a.startTime ?? "").localeCompare(b.startTime ?? "");
    if (byStart !== 0) return byStart;
    const order: Record<PoolGameType, number> = { V86: 0, V85: 1, dd: 2 };
    return order[a.type] - order[b.type];
  });

  return out;
}

/** Förvälj närmaste huvudspel: onsdags-V86 före lördags-V85 när det ligger närmast. */
export function pickDefaultPoolGame(games: GameOption[]): GameOption | undefined {
  const mainGames = games.filter((g) => g.type === "V86" || g.type === "V85");
  if (mainGames.length === 0) return undefined;

  const now = Date.now();
  const future = mainGames.filter((g) => {
    if (!g.startTime) return true;
    return new Date(g.startTime).getTime() >= now - 3600000;
  });

  const pool = future.length > 0 ? future : mainGames;
  return [...pool].sort((a, b) => {
    const byStart = (a.startTime ?? "").localeCompare(b.startTime ?? "");
    if (byStart !== 0) return byStart;
    const order: Record<PoolGameType, number> = { V86: 0, V85: 1, dd: 2 };
    return order[a.type] - order[b.type];
  })[0];
}

/** @deprecated Använd pickDefaultPoolGame */
export const pickDefaultV85Game = pickDefaultPoolGame;
/** @deprecated Använd pickDefaultPoolGame */
export const pickDefaultV86Game = pickDefaultPoolGame;

function sanitizeStartForPrematch(start: AtgStart): AtgStart {
  const sanitizedPools = start.pools
    ? Object.fromEntries(
        Object.entries(start.pools).map(([key, value]) => [
          key,
          {
            ...value,
            result: undefined,
            payouts: undefined,
            status: value?.status === "results" ? "open" : value?.status,
          },
        ]),
      )
    : undefined;
  return {
    ...start,
    result: undefined,
    pools: sanitizedPools,
  };
}

function sanitizeRaceForPrematch(race: AtgRace): AtgRace {
  const sanitizedPools = race.pools
    ? Object.fromEntries(
        Object.entries(race.pools).map(([key, value]) => [
          key,
          {
            ...value,
            result: undefined,
            status: value?.status === "results" ? "open" : value?.status,
          },
        ]),
      )
    : undefined;
  return {
    ...race,
    status: race.status === "results" ? "open" : race.status,
    result: undefined,
    pools: sanitizedPools,
    starts: (race.starts ?? []).map(sanitizeStartForPrematch),
  };
}

export function sanitizeHistoricalGameForPrematch(game: AtgGame): AtgGame {
  const sanitizedPools = game.pools
    ? Object.fromEntries(
        Object.entries(game.pools).map(([key, value]) => [
          key,
          {
            ...value,
            result: undefined,
            payouts: value?.payouts,
            status: value?.status === "results" ? "open" : value?.status,
          },
        ]),
      )
    : undefined;
  return {
    ...game,
    status: game.status === "results" ? "open" : game.status,
    pools: sanitizedPools,
    races: game.races.map(sanitizeRaceForPrematch),
  };
}

export async function buildSnapshotFromGame(
  game: AtgGame,
  input: Omit<PipelineInput, "date" | "gameId"> = {},
): Promise<FetchSnapshot> {
  const gameType = game.type as PoolGameType;

  const budgetKr = input.budgetKr ?? defaultBudgetKr(gameType);
  const targetMinPayoutKr = input.targetMinPayoutKr ?? defaultMinPayoutKr(gameType);

  let travsportCount = 0;
  let travsportIndex;
  if (input.includeTravsport !== false) {
    travsportIndex = await fetchTravsportForGame(game, {
      useCache: true,
      dbCache: input.travsportDbCache,
    });
    travsportCount = Object.keys(travsportIndex).length;
  }

  const legs = analyzeGame(game, travsportIndex);
  const bestSkrell = pickBestSkrellLeg(legs);
  const system = buildSystem(game.id, gameType, legs, {
    budgetKr,
    targetMinPayoutKr,
    forceSkrellLeg: bestSkrell?.leg ?? null,
  });

  let andelsspel;
  if (input.includeAndelsspel !== false && gameType !== "dd") {
    try {
      andelsspel = await fetchAndelShares(game.id, 12);
    } catch {
      andelsspel = undefined;
    }
  }

  const firstRaceStart = game.races[0]?.startTime ?? game.races[0]?.scheduledStartTime;

  return {
    fetchedAt: new Date().toISOString(),
    game,
    legs,
    system,
    andelsspel,
    meta: {
      poolStartLabel: formatStartLabel(firstRaceStart),
      poolWeekday: weekdayFromIso(firstRaceStart),
      isSaturdayRound: isSaturdayStart(firstRaceStart),
      isWednesdayRound: isWednesdayStart(firstRaceStart),
      analysisModel: `checklist-v1 + Travsport (${travsportCount} hästar)`,
      travsportHorses: travsportCount,
    },
  };
}

export async function buildSnapshot(input: PipelineInput): Promise<FetchSnapshot> {
  const date = input.date ?? todayIso();

  let gameId = input.gameId;
  if (!gameId) {
    const resolved = await resolveGame(date, "V86");
    gameId = resolved.gameId;
  }

  const game = await fetchGame(gameId);
  return buildSnapshotFromGame(game, input);
}
