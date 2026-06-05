import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fetchCalendarDay, fetchGame, listAllowedGamesFromCalendar } from "../src/atg-api";
import { buildSnapshotFromGame, sanitizeHistoricalGameForPrematch } from "../src/pipeline";
import { fileCacheBackend } from "../src/travsport/file-cache";
import type { AtgGame, AtgStart, PoolGameType } from "../src/types";
import { buildSystemHitSummary, extractTravResult } from "../../src/lib/trav-learning.server";

type GameSummaryRow = {
  gameId: string;
  gameType: PoolGameType;
  gameDate: string;
  raceCount: number;
  budgetKr: number;
  costKr: number;
  rows: number;
  correctLegs: number;
  totalLegs: number;
  payoutKr: number;
  netKr: number;
  fullHit: boolean;
  maxRacePayoutKr: number;
};

type RaceSummaryRow = {
  gameId: string;
  gameType: PoolGameType;
  gameDate: string;
  leg: number;
  raceId: string;
  track: string;
  raceName: string;
  distance: number | null;
  startMethod: string;
  winnerNumbers: string;
  winnerNames: string;
  victoryMargin: string;
  top3: string;
};

type StartSummaryRow = {
  gameId: string;
  raceId: string;
  leg: number;
  number: number;
  horse: string;
  driver: string;
  trainer: string;
  postPosition: number | null;
  finishOrder: number | null;
  place: number | null;
  kmTime: string;
  finalOdds: number | null;
};

function parseDateOnly(iso?: string | null) {
  return (iso ?? "").slice(0, 10);
}

function dateRange(fromDate: string, toDate: string) {
  const out: string[] = [];
  let cursor = new Date(`${fromDate}T12:00:00Z`);
  const end = new Date(`${toDate}T12:00:00Z`);
  while (cursor <= end) {
    out.push(cursor.toISOString().slice(0, 10));
    cursor = new Date(cursor.getTime() + 86400000);
  }
  return out;
}

function kmTimeToString(km?: { minutes?: number; seconds?: number; tenths?: number } | null): string {
  if (!km) return "";
  const min = km.minutes ?? 0;
  const sec = km.seconds ?? 0;
  const tenth = km.tenths ?? 0;
  return `${min > 0 ? `${min}:` : ""}${sec},${tenth}`;
}

function asCsv<T extends Record<string, unknown>>(rows: T[]): string {
  if (rows.length === 0) return "";
  const cols = Object.keys(rows[0]);
  const esc = (value: unknown) => {
    const text = String(value ?? "");
    if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
    return text;
  };
  return [cols.join(","), ...rows.map((row) => cols.map((col) => esc(row[col])).join(","))].join("\n");
}

function monthKey(dateIso: string) {
  return dateIso.slice(0, 7);
}

function raceMaxPayout(game: AtgGame): number {
  const pool = game.pools?.[game.type];
  const payouts = Object.values(pool?.result?.payouts ?? {});
  return payouts.reduce((max, item) => Math.max(max, item?.payout ?? 0), 0);
}

function winnerNumbersFromRace(gameType: PoolGameType, race: AtgGame["races"][number]): number[] {
  const winners = race.pools?.[gameType]?.result?.winners;
  if (Array.isArray(winners) && winners.every((w) => typeof w === "number")) {
    return winners as number[];
  }
  if (Array.isArray(winners)) {
    return winners
      .flatMap((w) =>
        typeof w === "object" && w && "combination" in w
          ? ((w.combination ?? []).filter((n) => typeof n === "number") as number[])
          : [],
      )
      .filter((n, i, arr) => arr.indexOf(n) === i);
  }
  return [];
}

function driverName(start: AtgStart) {
  return (
    start.driver?.shortName ??
    [start.driver?.firstName, start.driver?.lastName].filter(Boolean).join(" ") ??
    ""
  );
}

function trainerName(start: AtgStart) {
  return (
    start.horse?.trainer?.shortName ??
    [start.horse?.trainer?.firstName, start.horse?.trainer?.lastName].filter(Boolean).join(" ") ??
    ""
  );
}

async function main() {
  const fromDate = "2026-01-01";
  const toDate = new Date().toISOString().slice(0, 10);
  const dates = dateRange(fromDate, toDate);
  const seen = new Set<string>();
  const entries: Array<{ gameId: string; gameType: PoolGameType; gameDate: string }> = [];

  for (const date of dates) {
    const calendar = await fetchCalendarDay(date).catch(() => null);
    if (!calendar?.games) continue;
    for (const { type, entries: dayEntries } of listAllowedGamesFromCalendar(calendar.games)) {
      for (const entry of dayEntries) {
        if (!entry?.id || seen.has(entry.id)) continue;
        seen.add(entry.id);
        entries.push({
          gameId: entry.id,
          gameType: type,
          gameDate: date,
        });
      }
    }
  }

  const gameRows: GameSummaryRow[] = [];
  const raceRows: RaceSummaryRow[] = [];
  const startRows: StartSummaryRow[] = [];

  for (const entry of entries) {
    const game = await fetchGame(entry.gameId).catch(() => null);
    if (!game || game.status !== "results") continue;

    const gameDate =
      parseDateOnly(game.races[0]?.date) ||
      parseDateOnly(game.races[0]?.startTime) ||
      parseDateOnly(game.races[0]?.scheduledStartTime) ||
      entry.gameDate;
    if (!gameDate.startsWith("2026")) continue;

    const prematchGame = sanitizeHistoricalGameForPrematch(game);
    const snapshot = await buildSnapshotFromGame(prematchGame, {
      ruleId: "rule5",
      autoBudget: true,
      includeAndelsspel: false,
      includeTravsport: true,
      travsportDbCache: fileCacheBackend,
      travsportAllowStaleCache: true,
    });
    const resolved = extractTravResult(game);
    const hitSummary = buildSystemHitSummary(snapshot.system, resolved);

    gameRows.push({
      gameId: game.id,
      gameType: game.type,
      gameDate,
      raceCount: game.races.length,
      budgetKr: snapshot.system.budgetKr,
      costKr: snapshot.system.costKr,
      rows: snapshot.system.rows,
      correctLegs: hitSummary.correctLegs,
      totalLegs: hitSummary.totalLegs,
      payoutKr: hitSummary.payoutAmountKr ?? 0,
      netKr: (hitSummary.payoutAmountKr ?? 0) - snapshot.system.costKr,
      fullHit: hitSummary.fullHit,
      maxRacePayoutKr: raceMaxPayout(game),
    });

    game.races.forEach((race, index) => {
      const winners = winnerNumbersFromRace(game.type, race);
      const winnerNames = winners
        .map((winner) => race.starts.find((start) => start.number === winner)?.horse?.name ?? `nr ${winner}`)
        .join(" | ");
      const top3 = [...(race.starts ?? [])]
        .filter((start) => (start.result?.finishOrder ?? 999) <= 3)
        .sort((a, b) => (a.result?.finishOrder ?? 999) - (b.result?.finishOrder ?? 999))
        .map((start) => `${start.result?.finishOrder}. ${start.number} ${start.horse?.name ?? ""}`)
        .join(" | ");
      raceRows.push({
        gameId: game.id,
        gameType: game.type,
        gameDate,
        leg: index + 1,
        raceId: race.id,
        track: race.track?.name ?? "",
        raceName: race.name ?? "",
        distance: race.distance ?? null,
        startMethod: race.startMethod ?? "",
        winnerNumbers: winners.join("|"),
        winnerNames,
        victoryMargin: race.result?.victoryMargin ?? "",
        top3,
      });

      race.starts.forEach((start) => {
        startRows.push({
          gameId: game.id,
          raceId: race.id,
          leg: index + 1,
          number: start.number,
          horse: start.horse?.name ?? "",
          driver: driverName(start),
          trainer: trainerName(start),
          postPosition: start.postPosition ?? null,
          finishOrder: start.result?.finishOrder ?? null,
          place: start.result?.place ?? null,
          kmTime: kmTimeToString(start.result?.kmTime ?? null),
          finalOdds: start.result?.finalOdds ?? null,
        });
      });
    });
  }

  gameRows.sort((a, b) => a.gameDate.localeCompare(b.gameDate) || a.gameType.localeCompare(b.gameType));
  raceRows.sort((a, b) => a.gameDate.localeCompare(b.gameDate) || a.gameId.localeCompare(b.gameId) || a.leg - b.leg);
  startRows.sort((a, b) => a.gameId.localeCompare(b.gameId) || a.leg - b.leg || a.number - b.number);

  const monthlyNet = new Map<string, number>();
  for (const row of gameRows) {
    const mk = monthKey(row.gameDate);
    monthlyNet.set(mk, (monthlyNet.get(mk) ?? 0) + row.netKr);
  }
  const monthEntries = [...monthlyNet.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const monthsAt10kPlus = monthEntries.filter(([, net]) => net >= 10_000).length;
  const maxHit = Math.max(0, ...gameRows.map((row) => row.payoutKr));
  const has100k = gameRows.some((row) => row.payoutKr >= 100_000);
  const hasMillion = gameRows.some((row) => row.payoutKr >= 1_000_000);

  const aggregate = {
    generatedAt: new Date().toISOString(),
    dateRange: { fromDate, toDate },
    gameCount: gameRows.length,
    raceCount: raceRows.length,
    startCount: startRows.length,
    totalCostKr: gameRows.reduce((sum, row) => sum + row.costKr, 0),
    totalPayoutKr: gameRows.reduce((sum, row) => sum + row.payoutKr, 0),
    totalNetKr: gameRows.reduce((sum, row) => sum + row.netKr, 0),
    roi:
      gameRows.reduce((sum, row) => sum + row.costKr, 0) > 0
        ? gameRows.reduce((sum, row) => sum + row.netKr, 0) / gameRows.reduce((sum, row) => sum + row.costKr, 0)
        : 0,
    monthsAt10kPlus,
    monthCount: monthEntries.length,
    monthlyNet: Object.fromEntries(monthEntries),
    maxSinglePayoutKr: maxHit,
    has100k,
    hasMillion,
    requirementCheck: {
      monthlyPlus10kEveryMonth: monthEntries.every(([, net]) => net >= 10_000),
      hasPotentialOver100k: has100k,
      hasPotentialMillion: hasMillion,
    },
  };

  const outDir = resolve("v86", "output");
  mkdirSync(outDir, { recursive: true });

  writeFileSync(resolve(outDir, "trav-2026-games-rule5.csv"), asCsv(gameRows), "utf-8");
  writeFileSync(resolve(outDir, "trav-2026-races-rule5.csv"), asCsv(raceRows), "utf-8");
  writeFileSync(resolve(outDir, "trav-2026-starts-rule5.csv"), asCsv(startRows), "utf-8");
  writeFileSync(
    resolve(outDir, "trav-2026-analysis-rule5.json"),
    JSON.stringify({ aggregate, gameRows, raceRows }, null, 2),
    "utf-8",
  );

  const topMonths = monthEntries
    .slice()
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([month, net]) => `${month}: ${Math.round(net)} kr`);

  console.log(`Analyserade omgångar: ${gameRows.length}`);
  console.log(`Månader >= +10 000 kr: ${monthsAt10kPlus}/${monthEntries.length}`);
  console.log(`Maxutdelning i ett spel: ${Math.round(maxHit).toLocaleString("sv-SE")} kr`);
  console.log(`100k träffad: ${has100k ? "ja" : "nej"} | Miljon träffad: ${hasMillion ? "ja" : "nej"}`);
  console.log(`Bästa månader: ${topMonths.join(" | ")}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
