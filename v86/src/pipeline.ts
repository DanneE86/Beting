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
  collectUpcomingV85,
  isSaturdayStart,
  weekdayFromIso,
} from "./v85-schedule";
import type { FetchSnapshot, PoolGameType } from "./types";

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

  out.sort((a, b) => {
    if (a.type !== b.type) return a.type === "V85" ? -1 : 1;
    return (a.startTime ?? "").localeCompare(b.startTime ?? "");
  });

  return out;
}

/** Förvälj nästa lördags-V85, annars nästa V85 i listan. */
export function pickDefaultV85Game(games: GameOption[]): GameOption | undefined {
  const v85 = games.filter((g) => g.type === "V85");
  if (v85.length === 0) return undefined;

  const now = Date.now();
  const future = v85.filter((g) => {
    if (!g.startTime) return true;
    return new Date(g.startTime).getTime() >= now - 3600000;
  });

  const saturday = future.find((g) => g.isSaturdayRound);
  if (saturday) return saturday;

  return future[0] ?? v85[0];
}

/** @deprecated Använd pickDefaultV85Game */
export const pickDefaultV86Game = pickDefaultV85Game;

export async function buildSnapshot(input: PipelineInput): Promise<FetchSnapshot> {
  const date = input.date ?? todayIso();

  let gameId = input.gameId;
  if (!gameId) {
    const resolved = await resolveGame(date, "V85");
    gameId = resolved.gameId;
  }

  const game = await fetchGame(gameId);
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
  if (input.includeAndelsspel !== false && gameType === "V85") {
    try {
      andelsspel = await fetchAndelShares(gameId, 12);
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
      analysisModel: `checklist-v1 + Travsport (${travsportCount} hästar)`,
      travsportHorses: travsportCount,
    },
  };
}
