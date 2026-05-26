import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fetchCalendarDay, fetchGame, listAllowedGamesFromCalendar } from "../src/atg-api";
import { buildSnapshotFromGame, sanitizeHistoricalGameForPrematch } from "../src/pipeline";
import { fileCacheBackend } from "../src/travsport/file-cache";
import { buildSystemHitSummary, extractTravResult } from "../../src/lib/trav-learning.server";

const BUDGETS = [600, 700, 800, 900, 1000] as const;
const TARGETS = [30_000, 40_000, 50_000, 60_000, 75_000, 100_000] as const;
const MAX_ROUNDS = 25;
const LOOKBACK_DAYS = 420;

type SaturdayRound = {
  gameId: string;
  gameDate: string;
};

type RoundResult = {
  gameId: string;
  gameDate: string;
  costKr: number;
  payoutKr: number;
  netKr: number;
  correctLegs: number;
  totalLegs: number;
  fullHit: boolean;
  spikeCount: number;
  rows: number;
};

type AggregateResult = {
  budgetKr: number;
  targetMinPayoutKr: number;
  rounds: number;
  turnoverKr: number;
  payoutKr: number;
  netKr: number;
  roi: number;
  hitRate: number;
  fullHitRate: number;
  averageNetKr: number;
  medianNetKr: number;
  maxPayoutKr: number;
  bigHits50k: number;
  bigHits100k: number;
  profitableMonths: number;
  monthCount: number;
  profitableMonthShare: number;
  averageSpikes: number;
  averageRows: number;
  score: number;
  monthlyNetKr: Record<string, number>;
  roundResults: RoundResult[];
};

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function isSaturday(date: Date): boolean {
  return date.getUTCDay() === 6;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function scoreAggregate(result: AggregateResult): number {
  return (
    result.hitRate * 70 +
    result.profitableMonthShare * 80 +
    result.fullHitRate * 28 +
    result.roi * 24 +
    result.medianNetKr / 180 +
    result.averageNetKr / 120 +
    result.bigHits50k * 0.75 +
    result.bigHits100k * 1.5 +
    Math.min(10, result.maxPayoutKr / 40_000)
  );
}

async function collectLatestSaturdayRounds(): Promise<SaturdayRound[]> {
  const rounds: SaturdayRound[] = [];
  const seen = new Set<string>();
  const today = new Date();

  for (let daysBack = 0; daysBack <= LOOKBACK_DAYS && rounds.length < MAX_ROUNDS; daysBack++) {
    const date = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - daysBack));
    if (!isSaturday(date)) continue;

    const dateIso = formatDate(date);
    const calendar = await fetchCalendarDay(dateIso).catch(() => null);
    if (!calendar?.games) continue;

    const entries =
      listAllowedGamesFromCalendar(calendar.games).find((item) => item.type === "V85")?.entries ?? [];

    for (const entry of entries) {
      if (rounds.length >= MAX_ROUNDS) break;
      if (seen.has(entry.id)) continue;
      const game = await fetchGame(entry.id).catch(() => null);
      if (!game || game.status !== "results") continue;
      const startTime = game.races[0]?.date ?? game.races[0]?.startTime ?? game.races[0]?.scheduledStartTime ?? dateIso;
      const startDate = new Date(startTime);
      if (!isSaturday(startDate)) continue;
      rounds.push({
        gameId: game.id,
        gameDate: formatDate(startDate),
      });
      seen.add(game.id);
    }
  }

  return rounds.sort((a, b) => a.gameDate.localeCompare(b.gameDate));
}

async function runAggregate(
  rounds: SaturdayRound[],
  budgetKr: number,
  targetMinPayoutKr: number,
): Promise<AggregateResult> {
  const monthlyNetKr = new Map<string, number>();
  const roundResults: RoundResult[] = [];

  for (const round of rounds) {
    const fullGame = await fetchGame(round.gameId);
    const prematchGame = sanitizeHistoricalGameForPrematch(fullGame);
    const snapshot = await buildSnapshotFromGame(prematchGame, {
      budgetKr,
      targetMinPayoutKr,
      includeAndelsspel: false,
      includeTravsport: true,
      travsportDbCache: fileCacheBackend,
      travsportAllowStaleCache: true,
    });
    const resolved = extractTravResult(fullGame);
    const hitSummary = buildSystemHitSummary(snapshot.system, resolved);
    const payoutKr = hitSummary.payoutAmountKr ?? 0;
    const netKr = payoutKr - snapshot.system.costKr;
    const monthKey = round.gameDate.slice(0, 7);
    monthlyNetKr.set(monthKey, (monthlyNetKr.get(monthKey) ?? 0) + netKr);
    roundResults.push({
      gameId: round.gameId,
      gameDate: round.gameDate,
      costKr: snapshot.system.costKr,
      payoutKr,
      netKr,
      correctLegs: hitSummary.correctLegs,
      totalLegs: hitSummary.totalLegs,
      fullHit: hitSummary.fullHit,
      spikeCount: snapshot.system.selections.filter((selection) => selection.type !== "gardering").length,
      rows: snapshot.system.rows,
    });
  }

  const turnoverKr = roundResults.reduce((sum, row) => sum + row.costKr, 0);
  const payoutKr = roundResults.reduce((sum, row) => sum + row.payoutKr, 0);
  const netKr = payoutKr - turnoverKr;
  const hitRate = roundResults.filter((row) => row.payoutKr > 0).length / Math.max(1, roundResults.length);
  const fullHitRate = roundResults.filter((row) => row.fullHit).length / Math.max(1, roundResults.length);
  const profitableMonths = [...monthlyNetKr.values()].filter((value) => value > 0).length;
  const result: AggregateResult = {
    budgetKr,
    targetMinPayoutKr,
    rounds: roundResults.length,
    turnoverKr,
    payoutKr,
    netKr,
    roi: turnoverKr > 0 ? netKr / turnoverKr : 0,
    hitRate,
    fullHitRate,
    averageNetKr: roundResults.length > 0 ? netKr / roundResults.length : 0,
    medianNetKr: median(roundResults.map((row) => row.netKr)),
    maxPayoutKr: Math.max(0, ...roundResults.map((row) => row.payoutKr)),
    bigHits50k: roundResults.filter((row) => row.payoutKr >= 50_000).length,
    bigHits100k: roundResults.filter((row) => row.payoutKr >= 100_000).length,
    profitableMonths,
    monthCount: monthlyNetKr.size,
    profitableMonthShare: profitableMonths / Math.max(1, monthlyNetKr.size),
    averageSpikes:
      roundResults.reduce((sum, row) => sum + row.spikeCount, 0) / Math.max(1, roundResults.length),
    averageRows:
      roundResults.reduce((sum, row) => sum + row.rows, 0) / Math.max(1, roundResults.length),
    score: 0,
    monthlyNetKr: Object.fromEntries([...monthlyNetKr.entries()].sort((a, b) => a[0].localeCompare(b[0]))),
    roundResults,
  };
  result.score = scoreAggregate(result);
  return result;
}

async function main() {
  const rounds = await collectLatestSaturdayRounds();
  if (rounds.length < MAX_ROUNDS) {
    throw new Error(`Hittade bara ${rounds.length} lördagsomgångar för V85.`);
  }

  const allResults: AggregateResult[] = [];
  for (const budgetKr of BUDGETS) {
    for (const targetMinPayoutKr of TARGETS) {
      const result = await runAggregate(rounds, budgetKr, targetMinPayoutKr);
      allResults.push(result);
      console.log(
        [
          `budget=${budgetKr}`,
          `target=${targetMinPayoutKr}`,
          `roi=${(result.roi * 100).toFixed(1)}%`,
          `träff=${(result.hitRate * 100).toFixed(1)}%`,
          `plusmån=${result.profitableMonths}/${result.monthCount}`,
          `storvinster50=${result.bigHits50k}`,
        ].join(" | "),
      );
    }
  }

  const byBudget = Object.fromEntries(
    BUDGETS.map((budgetKr) => {
      const budgetResults = allResults
        .filter((result) => result.budgetKr === budgetKr)
        .sort((a, b) => b.score - a.score || b.roi - a.roi || b.netKr - a.netKr);
      return [budgetKr, { best: budgetResults[0], all: budgetResults }];
    }),
  );

  const overallBest = [...allResults].sort((a, b) => b.score - a.score || b.roi - a.roi || b.netKr - a.netKr)[0];

  const output = {
    generatedAt: new Date().toISOString(),
    rounds,
    budgets: BUDGETS,
    targets: TARGETS,
    overallBest,
    byBudget,
    leaderboard: [...allResults]
      .sort((a, b) => b.score - a.score || b.roi - a.roi || b.netKr - a.netKr)
      .slice(0, 10),
  };

  const outDir = resolve("v86", "output");
  mkdirSync(outDir, { recursive: true });
  const outFile = resolve(outDir, "v85-saturday-analysis.json");
  writeFileSync(outFile, JSON.stringify(output, null, 2), "utf-8");
  console.log(`Sparade analys till ${outFile}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
