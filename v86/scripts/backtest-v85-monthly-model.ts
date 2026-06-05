/**
 * Backtest: senaste 20 lördags-V85 omgångar
 * Testar rule2 / rule5 / rule6 × budget 600/700/800
 * Primärt mål: maximal andel månader med plus (profitableMonthShare)
 * Kör: npx tsx v86/scripts/backtest-v85-monthly-model.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fetchCalendarDay, fetchGame, listAllowedGamesFromCalendar } from "../src/atg-api";
import { buildSnapshotFromGame, sanitizeHistoricalGameForPrematch } from "../src/pipeline";
import { fileCacheBackend } from "../src/travsport/file-cache";
import { buildSystemHitSummary, extractTravResult } from "../../src/lib/trav-learning.server";
import type { TravRuleId } from "../src/types";

// rule2/5/6 delar identisk hästpoängsättning (alla usesMarketData=true, samma checklista).
const RULES: TravRuleId[] = ["rule2", "rule5", "rule6"];
const BUDGETS = [600, 700, 800] as const;
const MAX_ROUNDS = 20;
const LOOKBACK_DAYS = 500;

type Round = { gameId: string; gameDate: string };

type RoundResult = {
  gameId: string;
  gameDate: string;
  ruleId: string;
  budgetKr: number;
  costKr: number;
  payoutKr: number;
  netKr: number;
  correctLegs: number;
  totalLegs: number;
  fullHit: boolean;
  spikeCount: number;
  rows: number;
};

type Config = {
  ruleId: string;
  budgetKr: number;
};

type AggResult = {
  config: Config;
  rounds: number;
  turnoverKr: number;
  payoutKr: number;
  netKr: number;
  roi: number;
  hitRate: number;        // andel omgångar med någon utdelning
  sixPlusRate: number;    // andel omgångar med 6+ rätt
  fullHitRate: number;    // andel 8/8
  avgNetKr: number;
  medianNetKr: number;
  maxPayoutKr: number;
  bigHits50k: number;
  bigHits100k: number;
  avgSpikes: number;
  avgRows: number;
  profitableMonths: number;
  totalMonths: number;
  profitableMonthShare: number;
  monthlyNet: Record<string, number>;
  score: number;
  rounds_detail: RoundResult[];
};

function isSaturday(date: Date): boolean {
  return date.getUTCDay() === 6;
}

function fmtDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function score(r: AggResult): number {
  // Primärt: månadsplus. Sekundärt: ROI och storvinster.
  return (
    r.profitableMonthShare * 100 +
    r.hitRate * 55 +
    r.roi * 30 +
    r.sixPlusRate * 35 +
    r.fullHitRate * 20 +
    r.medianNetKr / 200 +
    r.avgNetKr / 150 +
    r.bigHits50k * 0.8 +
    r.bigHits100k * 1.8 +
    Math.min(8, r.maxPayoutKr / 50_000)
  );
}

async function collectRounds(): Promise<Round[]> {
  const rounds: Round[] = [];
  const seen = new Set<string>();
  const today = new Date();

  for (let daysBack = 0; daysBack <= LOOKBACK_DAYS && rounds.length < MAX_ROUNDS; daysBack++) {
    const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - daysBack));
    if (!isSaturday(d)) continue;

    const dateIso = fmtDate(d);
    const calendar = await fetchCalendarDay(dateIso).catch(() => null);
    if (!calendar?.games) continue;

    const entries = listAllowedGamesFromCalendar(calendar.games).find(g => g.type === "V85")?.entries ?? [];
    for (const entry of entries) {
      if (rounds.length >= MAX_ROUNDS) break;
      if (seen.has(entry.id)) continue;
      const game = await fetchGame(entry.id).catch(() => null);
      if (!game || game.status !== "results") continue;
      const startRaw = game.races[0]?.date ?? game.races[0]?.startTime ?? game.races[0]?.scheduledStartTime ?? dateIso;
      const startDate = new Date(startRaw);
      if (!isSaturday(startDate)) continue;
      rounds.push({ gameId: game.id, gameDate: fmtDate(startDate) });
      seen.add(game.id);
    }
  }

  return rounds.sort((a, b) => a.gameDate.localeCompare(b.gameDate));
}

async function runConfig(rounds: Round[], config: Config): Promise<AggResult> {
  const monthly = new Map<string, number>();
  const details: RoundResult[] = [];

  for (const round of rounds) {
    const fullGame = await fetchGame(round.gameId);
    const prematch = sanitizeHistoricalGameForPrematch(fullGame);
    const snapshot = await buildSnapshotFromGame(prematch, {
      ruleId: config.ruleId as TravRuleId,
      budgetKr: config.budgetKr,
      includeAndelsspel: false,
      includeTravsport: true,
      travsportDbCache: fileCacheBackend,
      travsportAllowStaleCache: true,
    });
    const resolved = extractTravResult(fullGame);
    const hit = buildSystemHitSummary(snapshot.system, resolved);
    const payoutKr = hit.payoutAmountKr ?? 0;
    const netKr = payoutKr - snapshot.system.costKr;
    const monthKey = round.gameDate.slice(0, 7);
    monthly.set(monthKey, (monthly.get(monthKey) ?? 0) + netKr);

    details.push({
      gameId: round.gameId,
      gameDate: round.gameDate,
      ruleId: config.ruleId,
      budgetKr: config.budgetKr,
      costKr: snapshot.system.costKr,
      payoutKr,
      netKr,
      correctLegs: hit.correctLegs,
      totalLegs: hit.totalLegs,
      fullHit: hit.fullHit,
      spikeCount: snapshot.system.selections.filter(s => s.type !== "gardering").length,
      rows: snapshot.system.rows,
    });
  }

  const turnoverKr = details.reduce((s, r) => s + r.costKr, 0);
  const payoutKr = details.reduce((s, r) => s + r.payoutKr, 0);
  const netKr = payoutKr - turnoverKr;
  const monthEntries = [...monthly.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const profitableMonths = monthEntries.filter(([, v]) => v > 0).length;

  const result: AggResult = {
    config,
    rounds: details.length,
    turnoverKr,
    payoutKr,
    netKr,
    roi: turnoverKr > 0 ? netKr / turnoverKr : 0,
    hitRate: details.filter(r => r.payoutKr > 0).length / Math.max(1, details.length),
    sixPlusRate: details.filter(r => r.correctLegs >= 6).length / Math.max(1, details.length),
    fullHitRate: details.filter(r => r.fullHit).length / Math.max(1, details.length),
    avgNetKr: netKr / Math.max(1, details.length),
    medianNetKr: median(details.map(r => r.netKr)),
    maxPayoutKr: Math.max(0, ...details.map(r => r.payoutKr)),
    bigHits50k: details.filter(r => r.payoutKr >= 50_000).length,
    bigHits100k: details.filter(r => r.payoutKr >= 100_000).length,
    avgSpikes: details.reduce((s, r) => s + r.spikeCount, 0) / Math.max(1, details.length),
    avgRows: details.reduce((s, r) => s + r.rows, 0) / Math.max(1, details.length),
    profitableMonths,
    totalMonths: monthEntries.length,
    profitableMonthShare: profitableMonths / Math.max(1, monthEntries.length),
    monthlyNet: Object.fromEntries(monthEntries),
    score: 0,
    rounds_detail: details,
  };
  result.score = score(result);
  return result;
}

function printResult(r: AggResult, rank: number) {
  const cfg = r.config;
  console.log(
    `#${rank} ${cfg.ruleId} budget=${cfg.budgetKr}` +
    ` | ROI=${(r.roi * 100).toFixed(1)}%` +
    ` | träff=${(r.hitRate * 100).toFixed(0)}%` +
    ` | 6+=${(r.sixPlusRate * 100).toFixed(0)}%` +
    ` | månadsplus=${r.profitableMonths}/${r.totalMonths}` +
    ` | netto=${Math.round(r.netKr).toLocaleString("sv-SE")} kr` +
    ` | medianNet=${Math.round(r.medianNetKr)} kr` +
    ` | spikar=${r.avgSpikes.toFixed(1)}` +
    ` | maxutdeln=${Math.round(r.maxPayoutKr / 1000)}k` +
    ` | score=${r.score.toFixed(1)}`
  );
}

async function main() {
  console.log("=== V85 Backtest – senaste 20 lördagsomgångar ===\n");
  console.log("Hämtar omgångar...");
  const rounds = await collectRounds();
  if (rounds.length < MAX_ROUNDS) {
    console.warn(`Varning: hittade bara ${rounds.length} av ${MAX_ROUNDS} omgångar`);
  }
  console.log(`Hittade ${rounds.length} omgångar: ${rounds[0]?.gameDate} → ${rounds[rounds.length - 1]?.gameDate}\n`);

  const configs: Config[] = [];
  for (const ruleId of RULES) {
    for (const budgetKr of BUDGETS) {
      configs.push({ ruleId, budgetKr });
    }
  }

  console.log(`Testar ${configs.length} konfigurationer × ${rounds.length} omgångar...\n`);
  const results: AggResult[] = [];

  for (let i = 0; i < configs.length; i++) {
    const cfg = configs[i];
    process.stdout.write(`[${i + 1}/${configs.length}] ${cfg.ruleId} ${cfg.budgetKr}kr... `);
    const result = await runConfig(rounds, cfg);
    results.push(result);
    console.log(`ROI=${(result.roi * 100).toFixed(1)}% månadsplus=${result.profitableMonths}/${result.totalMonths}`);
  }

  const ranked = [...results].sort((a, b) => b.score - a.score);

  console.log("\n=== LEADERBOARD (sorterat på månadsplus + ROI) ===");
  ranked.slice(0, 10).forEach((r, i) => printResult(r, i + 1));

  // Bäst per regel
  console.log("\n=== BÄST PER REGEL ===");
  for (const ruleId of RULES) {
    const best = ranked.filter(r => r.config.ruleId === ruleId)[0];
    if (best) printResult(best, 1);
  }

  // Månadsdetaljer för top-3
  console.log("\n=== MÅNADSDETALJER TOP 3 ===");
  for (const r of ranked.slice(0, 3)) {
    console.log(`\n${r.config.ruleId} budget=${r.config.budgetKr}:`);
    for (const [month, net] of Object.entries(r.monthlyNet)) {
      const plus = net >= 0 ? "+" : "";
      console.log(`  ${month}: ${plus}${Math.round(net).toLocaleString("sv-SE")} kr`);
    }
  }

  // Detaljanalys: spikmönster vs träff
  console.log("\n=== SPIKMÖNSTER vs TRÄFF (bästa konfig) ===");
  const top = ranked[0];
  if (top) {
    const spikeGroups = new Map<number, { hits: number; total: number; payouts: number[] }>();
    for (const r of top.rounds_detail) {
      const g = spikeGroups.get(r.spikeCount) ?? { hits: 0, total: 0, payouts: [] };
      g.total++;
      if (r.payoutKr > 0) { g.hits++; g.payouts.push(r.payoutKr); }
      spikeGroups.set(r.spikeCount, g);
    }
    for (const [spikes, g] of [...spikeGroups.entries()].sort((a, b) => a[0] - b[0])) {
      const avgPayout = g.payouts.length ? g.payouts.reduce((s, v) => s + v, 0) / g.payouts.length : 0;
      console.log(`  ${spikes} spikar: träff ${g.hits}/${g.total} (${Math.round(g.hits/g.total*100)}%) avgUtdeln=${Math.round(avgPayout).toLocaleString("sv-SE")} kr`);
    }

    // Korrekt antal ben-fördelning
    console.log("\n  Rätta ben-fördelning (bästa konfig):");
    const legDist = new Map<number, number>();
    for (const r of top.rounds_detail) {
      legDist.set(r.correctLegs, (legDist.get(r.correctLegs) ?? 0) + 1);
    }
    for (const [legs, count] of [...legDist.entries()].sort((a, b) => a[0] - b[0])) {
      console.log(`  ${legs}/${top.rounds_detail[0]?.totalLegs ?? 8} rätt: ${count} omgångar`);
    }
  }

  // Spara JSON
  const outDir = resolve("v86", "output");
  mkdirSync(outDir, { recursive: true });
  const outFile = resolve(outDir, "v85-monthly-backtest.json");
  writeFileSync(outFile, JSON.stringify({
    generatedAt: new Date().toISOString(),
    rounds,
    leaderboard: ranked.slice(0, 15).map(r => ({
      config: r.config,
      roi: Math.round(r.roi * 1000) / 10,
      hitRate: Math.round(r.hitRate * 1000) / 10,
      sixPlusRate: Math.round(r.sixPlusRate * 1000) / 10,
      profitableMonthShare: Math.round(r.profitableMonthShare * 100),
      profitableMonths: r.profitableMonths,
      totalMonths: r.totalMonths,
      netKr: Math.round(r.netKr),
      medianNetKr: Math.round(r.medianNetKr),
      avgSpikes: Math.round(r.avgSpikes * 10) / 10,
      avgRows: Math.round(r.avgRows * 10) / 10,
      bigHits50k: r.bigHits50k,
      bigHits100k: r.bigHits100k,
      maxPayoutKr: Math.round(r.maxPayoutKr),
      monthlyNet: r.monthlyNet,
      score: Math.round(r.score * 10) / 10,
    })),
    allResults: ranked.map(r => ({
      config: r.config,
      roi: Math.round(r.roi * 1000) / 10,
      profitableMonthShare: Math.round(r.profitableMonthShare * 100),
      profitableMonths: r.profitableMonths,
      totalMonths: r.totalMonths,
      netKr: Math.round(r.netKr),
      hitRate: Math.round(r.hitRate * 1000) / 10,
      sixPlusRate: Math.round(r.sixPlusRate * 1000) / 10,
      avgSpikes: Math.round(r.avgSpikes * 10) / 10,
      score: Math.round(r.score * 10) / 10,
    })),
  }, null, 2), "utf-8");
  console.log(`\nSparade resultat: ${outFile}`);
}

main().catch(err => { console.error(err); process.exit(1); });
