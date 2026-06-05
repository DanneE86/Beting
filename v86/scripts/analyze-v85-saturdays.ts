import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fetchCalendarDay, fetchGame, listAllowedGamesFromCalendar } from "../src/atg-api";
import { buildSnapshotFromGame, sanitizeHistoricalGameForPrematch } from "../src/pipeline";
import { fileCacheBackend } from "../src/travsport/file-cache";
import { buildSystemHitSummary, extractTravResult } from "../../src/lib/trav-learning.server";
import type { TravRuleId } from "../src/types";

// rule2/5/6 delar identisk hästpoängsättning (alla usesMarketData=true, samma checklista).
// rule7 är genuint annorlunda: conservativeGardering=true, spikTröskel 0.80 vs 0.72.
// Testa alla fyra för att bekräfta att rule7 faktiskt ger annorlunda system.
const RULES: TravRuleId[] = ["rule2", "rule5", "rule6"];
const BUDGETS = [600, 700, 800, 900, 1000] as const;
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
  ruleId: TravRuleId;
  budgetKr: number;
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
  ruleId: TravRuleId,
  budgetKr: number,
): Promise<AggregateResult> {
  const monthlyNetKr = new Map<string, number>();
  const roundResults: RoundResult[] = [];

  for (const round of rounds) {
    const fullGame = await fetchGame(round.gameId);
    const prematchGame = sanitizeHistoricalGameForPrematch(fullGame);
    const snapshot = await buildSnapshotFromGame(prematchGame, {
      ruleId,
      budgetKr,
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
    ruleId,
    budgetKr,
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
  const totalConfigs = RULES.length * BUDGETS.length;
  let configIndex = 0;
  for (const ruleId of RULES) {
    for (const budgetKr of BUDGETS) {
      configIndex++;
      process.stdout.write(`[${configIndex}/${totalConfigs}] ${ruleId} budget=${budgetKr}... `);
      const result = await runAggregate(rounds, ruleId, budgetKr);
      allResults.push(result);
      console.log(
        [
          `roi=${(result.roi * 100).toFixed(1)}%`,
          `träff=${(result.hitRate * 100).toFixed(1)}%`,
          `plusmån=${result.profitableMonths}/${result.monthCount}`,
          `storvinster50=${result.bigHits50k}`,
        ].join(" | "),
      );
    }
  }

  const sorted = [...allResults].sort((a, b) => b.score - a.score || b.roi - a.roi || b.netKr - a.netKr);
  const overallBest = sorted[0];

  const byRule = Object.fromEntries(
    RULES.map((ruleId) => {
      const ruleResults = sorted.filter((r) => r.ruleId === ruleId);
      return [ruleId, { best: ruleResults[0], avgSpikes: ruleResults.reduce((s, r) => s + r.averageSpikes, 0) / Math.max(1, ruleResults.length) }];
    }),
  );

  const byBudget = Object.fromEntries(
    BUDGETS.map((budgetKr) => {
      const budgetResults = sorted.filter((result) => result.budgetKr === budgetKr);
      return [budgetKr, { best: budgetResults[0] }];
    }),
  );

  const output = {
    generatedAt: new Date().toISOString(),
    rounds,
    rules: RULES,
    budgets: BUDGETS,
    overallBest,
    byRule,
    byBudget,
    leaderboard: sorted.slice(0, 15).map((r) => ({
      ruleId: r.ruleId,
      budgetKr: r.budgetKr,
      roi: Math.round(r.roi * 1000) / 10,
      hitRate: Math.round(r.hitRate * 1000) / 10,
      profitableMonths: r.profitableMonths,
      totalMonths: r.monthCount,
      netKr: Math.round(r.netKr),
      medianNetKr: Math.round(r.medianNetKr),
      avgSpikes: Math.round(r.averageSpikes * 10) / 10,
      avgRows: Math.round(r.averageRows * 10) / 10,
      bigHits50k: r.bigHits50k,
      maxPayoutKr: Math.round(r.maxPayoutKr),
      score: Math.round(r.score * 10) / 10,
    })),
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
