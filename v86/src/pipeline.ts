import { fetchAndelShares } from "./andelsspel";
import {
  fetchCalendarDay,
  fetchGame,
  listAllowedGamesFromCalendar,
  resolveGame,
} from "./atg-api";
import { fetchExpertDataBundle, applyRule3Overlay } from "./expert-data";
import { applyRule4Overlay, buildRule4MissingDataNotes } from "./rule4-data";
import { defaultBudgetKr, defaultMinPayoutKr, gameTypeLabel } from "./game-types";
import { analyzeGame } from "./analyze";
import { DEFAULT_TRAV_RULE_ID, TRAV_RULES, defaultRuleCoverage, normalizeTravRuleId } from "./rules";
import {
  AUTO_MAIN_POOL_BUDGETS_KR,
  buildSystem,
  recommendDdPlay,
  recommendMainPoolPlay,
} from "./system-builder";
import { fetchTravsportForGame } from "./travsport/fetch-game";
import type { TravsportIndex } from "./travsport/types";
import {
  collectUpcomingDd,
  collectUpcomingV86,
  collectUpcomingV85,
  isWednesdayStart,
  isSaturdayStart,
  weekdayFromIso,
} from "./v85-schedule";
import type {
  AtgGame,
  AtgRace,
  AtgStart,
  FetchSnapshot,
  PoolGameType,
  SnapshotRaceData,
  TravRuleId,
} from "./types";

export interface PipelineInput {
  date?: string;
  gameId?: string;
  ruleId?: TravRuleId;
  budgetKr?: number;
  targetMinPayoutKr?: number;
  autoBudget?: boolean;
  includeAndelsspel?: boolean;
  includeTravsport?: boolean;
  travsportDbCache?: import("./travsport/fetch-game").FetchGameTravsportOptions["dbCache"];
  travsportAllowStaleCache?: boolean;
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

  const upcomingDd = await collectUpcomingDd(date);
  for (const u of upcomingDd) {
    push({
      id: u.entry.id,
      type: "dd",
      typeLabel: gameTypeLabel("dd"),
      status: u.entry.status ?? "upcoming",
      startTime: u.startIso,
      trackNames: u.entry.name,
      startLabel: formatStartLabel(u.startIso),
      isUpcoming: u.calendarDate !== date,
    });
  }

  out.sort((a, b) => {
    const byStart = (a.startTime ?? "").localeCompare(b.startTime ?? "");
    if (byStart !== 0) return byStart;
    const order: Record<PoolGameType, number> = { dd: 0, V85: 1, V86: 2 };
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

function driverDisplayName(start: AtgStart): string {
  return (
    start.driver?.shortName ??
    [start.driver?.firstName, start.driver?.lastName].filter(Boolean).join(" ") ??
    ""
  );
}

export function buildSnapshotRaceData(
  game: AtgGame,
  travsportIndex?: TravsportIndex,
): SnapshotRaceData[] {
  return game.races.map((race, raceIndex) => ({
    leg: raceIndex + 1,
    raceId: race.id,
    raceNumber: race.number,
    raceName: race.name,
    status: race.status,
    date: race.date,
    startTime: race.startTime,
    scheduledStartTime: race.scheduledStartTime,
    track: race.track,
    distance: race.distance,
    startMethod: race.startMethod,
    result: race.result,
    pools: race.pools,
    starts: (race.starts ?? []).map((start) => {
      const travsportProfile = start.horse?.id ? travsportIndex?.[start.horse.id] ?? null : null;
      return {
        startId: start.id,
        number: start.number,
        postPosition: start.postPosition,
        scratched: start.scratched,
        distance: start.distance,
        horse: start.horse,
        driver: start.driver,
        pools: start.pools,
        result: start.result,
        travsportProfile,
        driverContext: {
          driverId: start.driver?.id ?? null,
          driverName: driverDisplayName(start) || `nr ${start.number}`,
          homeTrack: start.driver?.homeTrack?.name ?? null,
          pairedHorseStarts: travsportProfile?.driverPairStarts ?? 0,
          pairedHorseWins: travsportProfile?.driverPairWins ?? 0,
        },
      };
    }),
  }));
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
  const ruleId = normalizeTravRuleId(input.ruleId);
  const rule = TRAV_RULES[ruleId];

  const autoBudget = input.autoBudget === true;
  const floorMinPayoutKr =
    gameType === "dd"
      ? input.targetMinPayoutKr ?? defaultMinPayoutKr(gameType)
      : Math.max(30_000, input.targetMinPayoutKr ?? defaultMinPayoutKr(gameType));

  let travsportCount = 0;
  let travsportIndex;
  if (input.includeTravsport !== false) {
    travsportIndex = await fetchTravsportForGame(game, {
      useCache: true,
      dbCache: input.travsportDbCache,
      allowStaleCache: input.travsportAllowStaleCache,
    });
    travsportCount = Object.keys(travsportIndex).length;
  }

  let legs = analyzeGame(game, travsportIndex, ruleId);
  const raceData = buildSnapshotRaceData(game, travsportIndex);
  const raceStartCount = raceData.reduce((sum, race) => sum + race.starts.length, 0);

  let andelsspel;
  const shouldFetchAndelsspel = (input.includeAndelsspel !== false || ruleId === "rule3") && gameType !== "dd";
  if (shouldFetchAndelsspel) {
    try {
      andelsspel = await fetchAndelShares(game.id, 12);
    } catch {
      andelsspel = undefined;
    }
  }

  let expertSignals: FetchSnapshot["expertSignals"];
  let expertConsensus: FetchSnapshot["expertConsensus"];
  let coverage = defaultRuleCoverage(ruleId);
  let missingDataNotes: string[] | undefined;
  let expertSources: NonNullable<NonNullable<FetchSnapshot["meta"]>["rule"]>["expertSources"];

  if (ruleId === "rule3") {
    const expertBundle = await fetchExpertDataBundle(game, andelsspel);
    expertSignals = expertBundle.signals;
    expertConsensus = expertBundle.consensus;
    coverage = expertBundle.coverage;
    missingDataNotes = expertBundle.missingDataNotes;
    expertSources = expertBundle.sources;
    legs = applyRule3Overlay(legs, expertBundle.consensus);
  }
  if (ruleId === "rule4") {
    legs = applyRule4Overlay(legs, raceData);
    missingDataNotes = buildRule4MissingDataNotes(raceData);
  }

  const recommendedPlay = autoBudget
    ? gameType === "dd"
      ? recommendDdPlay(game.id, gameType, legs, floorMinPayoutKr)
      : recommendMainPoolPlay(game.id, gameType, legs, floorMinPayoutKr)
    : null;
  const budgetKr =
    recommendedPlay?.budgetKr ??
    (gameType === "dd"
      ? input.budgetKr ?? defaultBudgetKr(gameType)
      : AUTO_MAIN_POOL_BUDGETS_KR.includes((input.budgetKr ?? defaultBudgetKr(gameType)) as (typeof AUTO_MAIN_POOL_BUDGETS_KR)[number])
        ? (input.budgetKr ?? defaultBudgetKr(gameType))
        : defaultBudgetKr(gameType));
  const targetMinPayoutKr = recommendedPlay?.targetMinPayoutKr ?? floorMinPayoutKr;
  const system =
    recommendedPlay?.system ??
    buildSystem(game.id, gameType, legs, {
      budgetKr,
      targetMinPayoutKr,
    });

  const firstRaceStart = game.races[0]?.startTime ?? game.races[0]?.scheduledStartTime;

  return {
    fetchedAt: new Date().toISOString(),
    game,
    legs,
    raceData,
    system,
    andelsspel,
    expertSignals,
    expertConsensus,
    meta: {
      poolStartLabel: formatStartLabel(firstRaceStart),
      poolWeekday: weekdayFromIso(firstRaceStart),
      isSaturdayRound: isSaturdayStart(firstRaceStart),
      isWednesdayRound: isWednesdayStart(firstRaceStart),
      analysisModel: `${rule.label} · checklist-v1 + Travsport (${travsportCount} hästar)`,
      travsportHorses: travsportCount,
      fullRaceDataStored: true,
      fullRaceDataRaces: raceData.length,
      fullRaceDataStarts: raceStartCount,
      rule: {
        id: rule.id,
        label: rule.label,
        version: rule.version,
        usesMarketData: rule.usesMarketData,
        partialExpertMode:
          ruleId === "rule3" ? coverage.some((group) => group.status !== "available") : false,
        expertSourceCount: expertSources?.length ?? 0,
        expertSignalCount: expertSignals?.length ?? 0,
        expertSources,
        coverage,
        missingDataNotes,
      },
      recommendedPlay: recommendedPlay
        ? {
            mode: "auto-budget",
            budgetKr: recommendedPlay.budgetKr,
            targetMinPayoutKr: recommendedPlay.targetMinPayoutKr,
            opennessScore: recommendedPlay.opennessScore,
            reason: recommendedPlay.reason,
          }
        : undefined,
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
