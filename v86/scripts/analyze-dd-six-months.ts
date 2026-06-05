import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fetchCalendarDay, fetchGame, listAllowedGamesFromCalendar } from "../src/atg-api";
import { buildSnapshotFromGame, sanitizeHistoricalGameForPrematch } from "../src/pipeline";
import { fileCacheBackend } from "../src/travsport/file-cache";
import { buildSystemHitSummary, extractTravResult } from "../../src/lib/trav-learning.server";

const FIXED_BUDGETS = [50, 60] as const;
const LOOKBACK_DAYS = 190;

type Strategy =
  | {
      key: string;
      label: string;
      mode: "fixed";
      budgetKr: (typeof FIXED_BUDGETS)[number];
    }
  | {
      key: string;
      label: string;
      mode: "auto";
      budgetKr: "auto";
    };

type RoundRef = {
  gameId: string;
  gameDate: string;
};

type RoundResult = {
  gameId: string;
  gameDate: string;
  budgetKr: number;
  rows: number;
  costKr: number;
  payoutKr: number;
  netKr: number;
  correctLegs: number;
  totalLegs: number;
  fullHit: boolean;
};

type AggregateResult = {
  key: string;
  label: string;
  mode: "fixed" | "auto";
  budgetKr: number | "auto";
  rounds: number;
  turnoverKr: number;
  payoutKr: number;
  netKr: number;
  roi: number;
  hitRate: number;
  profitableMonths: number;
  monthCount: number;
  profitableMonthShare: number;
  medianMonthNetKr: number;
  averageMonthNetKr: number;
  maxDrawdownKr: number;
  maxPayoutKr: number;
  largestHitShare: number;
  averageBudgetKr: number;
  averageRows: number;
  budgetMix: Record<string, number>;
  monthlyNetKr: Record<string, number>;
  score: number;
  roundResults: RoundResult[];
};

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function buildStrategies(): Strategy[] {
  const fixed = FIXED_BUDGETS.map((budgetKr) => ({
    key: `fixed-${budgetKr}`,
    label: `Fast ${budgetKr} kr`,
    mode: "fixed" as const,
    budgetKr,
  }));
  const auto: Strategy[] = [{
    key: "auto",
    label: "Auto 30-40 kr",
    mode: "auto" as const,
    budgetKr: "auto" as const,
  }];
  return [...fixed, ...auto];
}

function scoreAggregate(result: AggregateResult): number {
  return (
    result.profitableMonthShare * 220 +
    result.profitableMonths * 10 +
    result.medianMonthNetKr / 20 +
    result.averageMonthNetKr / 35 +
    result.hitRate * 80 +
    result.roi * 15 -
    result.maxDrawdownKr / 40 -
    result.largestHitShare * 24
  );
}

function maxDrawdown(roundResults: RoundResult[]): number {
  let equity = 0;
  let peak = 0;
  let worst = 0;
  for (const row of [...roundResults].sort((a, b) => a.gameDate.localeCompare(b.gameDate))) {
    equity += row.netKr;
    peak = Math.max(peak, equity);
    worst = Math.max(worst, peak - equity);
  }
  return worst;
}

async function collectDdRounds(): Promise<RoundRef[]> {
  const rounds: RoundRef[] = [];
  const seen = new Set<string>();
  const today = new Date();
  const from = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  from.setUTCMonth(from.getUTCMonth() - 6);

  for (let daysBack = 0; daysBack <= LOOKBACK_DAYS; daysBack++) {
    const date = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - daysBack));
    if (date < from) break;

    const dateIso = formatDate(date);
    const calendar = await fetchCalendarDay(dateIso).catch(() => null);
    if (!calendar?.games) continue;

    const entries =
      listAllowedGamesFromCalendar(calendar.games).find((item) => item.type === "dd")?.entries ?? [];

    for (const entry of entries) {
      if (seen.has(entry.id)) continue;
      const game = await fetchGame(entry.id).catch(() => null);
      if (!game || game.status !== "results") continue;
      const gameDate =
        game.races[0]?.date?.slice(0, 10) ??
        game.races[0]?.startTime?.slice(0, 10) ??
        game.races[0]?.scheduledStartTime?.slice(0, 10) ??
        dateIso;
      rounds.push({ gameId: game.id, gameDate });
      seen.add(game.id);
    }
  }

  return rounds.sort((a, b) => a.gameDate.localeCompare(b.gameDate));
}

async function runAggregate(rounds: RoundRef[], strategy: Strategy): Promise<AggregateResult> {
  const monthlyNetKr = new Map<string, number>();
  const budgetMix = new Map<string, number>();
  const roundResults: RoundResult[] = [];

  for (const round of rounds) {
    const fullGame = await fetchGame(round.gameId);
    const prematchGame = sanitizeHistoricalGameForPrematch(fullGame);
    const snapshot = await buildSnapshotFromGame(prematchGame, {
      budgetKr: strategy.mode === "fixed" ? strategy.budgetKr : undefined,
      autoBudget: strategy.mode === "auto",
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
    budgetMix.set(
      String(snapshot.system.budgetKr),
      (budgetMix.get(String(snapshot.system.budgetKr)) ?? 0) + 1,
    );
    roundResults.push({
      gameId: round.gameId,
      gameDate: round.gameDate,
      budgetKr: snapshot.system.budgetKr,
      rows: snapshot.system.rows,
      costKr: snapshot.system.costKr,
      payoutKr,
      netKr,
      correctLegs: hitSummary.correctLegs,
      totalLegs: hitSummary.totalLegs,
      fullHit: hitSummary.fullHit,
    });
  }

  const turnoverKr = roundResults.reduce((sum, row) => sum + row.costKr, 0);
  const payoutKr = roundResults.reduce((sum, row) => sum + row.payoutKr, 0);
  const monthlyValues = [...monthlyNetKr.values()];
  const profitableMonths = monthlyValues.filter((value) => value > 0).length;
  const result: AggregateResult = {
    key: strategy.key,
    label: strategy.label,
    mode: strategy.mode,
    budgetKr: strategy.budgetKr,
    rounds: roundResults.length,
    turnoverKr,
    payoutKr,
    netKr: payoutKr - turnoverKr,
    roi: turnoverKr > 0 ? (payoutKr - turnoverKr) / turnoverKr : 0,
    hitRate: roundResults.filter((row) => row.payoutKr > 0).length / Math.max(1, roundResults.length),
    profitableMonths,
    monthCount: monthlyValues.length,
    profitableMonthShare: profitableMonths / Math.max(1, monthlyValues.length),
    medianMonthNetKr: median(monthlyValues),
    averageMonthNetKr:
      monthlyValues.reduce((sum, value) => sum + value, 0) / Math.max(1, monthlyValues.length),
    maxDrawdownKr: maxDrawdown(roundResults),
    maxPayoutKr: Math.max(0, ...roundResults.map((row) => row.payoutKr)),
    largestHitShare:
      payoutKr > 0 ? Math.max(0, ...roundResults.map((row) => row.payoutKr)) / payoutKr : 1,
    averageBudgetKr:
      roundResults.reduce((sum, row) => sum + row.budgetKr, 0) / Math.max(1, roundResults.length),
    averageRows:
      roundResults.reduce((sum, row) => sum + row.rows, 0) / Math.max(1, roundResults.length),
    budgetMix: Object.fromEntries([...budgetMix.entries()].sort((a, b) => a[0].localeCompare(b[0]))),
    monthlyNetKr: Object.fromEntries([...monthlyNetKr.entries()].sort((a, b) => a[0].localeCompare(b[0]))),
    score: 0,
    roundResults,
  };
  result.score = scoreAggregate(result);
  return result;
}

async function main() {
  const rounds = await collectDdRounds();
  if (rounds.length === 0) {
    throw new Error("Hittade inga avgjorda DD-omgångar senaste sex månaderna.");
  }

  const strategies = buildStrategies();
  const results: AggregateResult[] = [];

  for (const strategy of strategies) {
    const result = await runAggregate(rounds, strategy);
    results.push(result);
    console.log(
      [
        strategy.label,
        `roi=${(result.roi * 100).toFixed(1)}%`,
        `träff=${(result.hitRate * 100).toFixed(1)}%`,
        `plusmån=${result.profitableMonths}/${result.monthCount}`,
        `medianmånad=${Math.round(result.medianMonthNetKr)}`,
        `drawdown=${Math.round(result.maxDrawdownKr)}`,
      ].join(" | "),
    );
  }

  const leaderboard = [...results].sort(
    (a, b) =>
      b.score - a.score ||
      b.profitableMonthShare - a.profitableMonthShare ||
      b.medianMonthNetKr - a.medianMonthNetKr ||
      b.netKr - a.netKr,
  );

  const byFixedBudget = Object.fromEntries(
    FIXED_BUDGETS.map((budgetKr) => [
      budgetKr,
      leaderboard.filter((result) => result.mode === "fixed" && result.budgetKr === budgetKr),
    ]),
  );

  const output = {
    generatedAt: new Date().toISOString(),
    lookbackMonths: 6,
    roundCount: rounds.length,
    rounds,
    strategies,
    overallBest: leaderboard[0],
    bestFixed50: byFixedBudget[50]?.[0] ?? null,
    bestFixed60: byFixedBudget[60]?.[0] ?? null,
    bestAuto: leaderboard.find((result) => result.mode === "auto") ?? null,
    leaderboard: leaderboard.slice(0, 12),
    allResults: leaderboard,
  };

  const outDir = resolve("v86", "output");
  mkdirSync(outDir, { recursive: true });
  const outFile = resolve(outDir, "dd-six-month-analysis.json");
  writeFileSync(outFile, JSON.stringify(output, null, 2), "utf-8");
  console.log(`Sparade analys till ${outFile}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
