/**
 * Jämförelse: 2 system à 60 kr vs 1 system à 120/150 kr på samma 100 omgångar.
 * Kör: npx tsx v86/scripts/backtest-dd-single-high-budget.ts
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { buildSystemHitSummary, extractTravResult } from "../../src/lib/trav-learning.server";
import { fileCacheBackend } from "../src/travsport/file-cache";
import { fetchCalendarDay, fetchGame, listAllowedGamesFromCalendar } from "../src/atg-api";
import { buildSnapshotFromGame, sanitizeHistoricalGameForPrematch } from "../src/pipeline";

const BUDGETS = [60, 120, 150] as const;
const LOOKBACK_DAYS = 400;
const LIMIT = 100;

function formatDate(d: Date) { return d.toISOString().slice(0, 10); }

async function collectDdRounds() {
  const rounds: { gameId: string; gameDate: string }[] = [];
  const seen = new Set<string>();
  const today = new Date();
  for (let back = 0; back <= LOOKBACK_DAYS && rounds.length < LIMIT; back++) {
    const date = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - back));
    const dateIso = formatDate(date);
    const calendar = await fetchCalendarDay(dateIso).catch(() => null);
    if (!calendar?.games) continue;
    const entries = listAllowedGamesFromCalendar(calendar.games).find(i => i.type === "dd")?.entries ?? [];
    for (const entry of entries) {
      if (rounds.length >= LIMIT) break;
      if (seen.has(entry.id)) continue;
      const game = await fetchGame(entry.id).catch(() => null);
      if (!game || game.status !== "results" || (game.races?.length ?? 0) < 2) continue;
      const gameDate = game.races[0]?.date?.slice(0, 10) ?? game.races[0]?.startTime?.slice(0, 10) ?? dateIso;
      seen.add(entry.id);
      rounds.push({ gameId: entry.id, gameDate });
    }
  }
  return rounds.sort((a, b) => b.gameDate.localeCompare(a.gameDate));
}

type RoundRow = {
  gameDate: string;
  track: string;
  winners: string;
  budget: number;
  rows: number;
  costKr: number;
  picks: string;
  hit: boolean;
  correctLegs: number;
  payoutKr: number;
  netKr: number;
};

async function runBudget(rounds: { gameId: string; gameDate: string }[], budgetKr: number): Promise<RoundRow[]> {
  const rows: RoundRow[] = [];
  for (const round of rounds) {
    const fullGame = await fetchGame(round.gameId);
    const prematchGame = sanitizeHistoricalGameForPrematch(fullGame);
    const snapshot = await buildSnapshotFromGame(prematchGame, {
      budgetKr,
      targetMinPayoutKr: 1500,
      includeAndelsspel: false,
      includeTravsport: true,
      travsportDbCache: fileCacheBackend,
      travsportAllowStaleCache: true,
    });
    const resolved = extractTravResult(fullGame);
    const hit = buildSystemHitSummary(snapshot.system, resolved);
    const winners = resolved.legs.length >= 2
      ? `${resolved.legs[0]?.winners[0] ?? "?"}-${resolved.legs[1]?.winners[0] ?? "?"}`
      : "?";
    const picks = snapshot.system.selections
      .sort((a, b) => a.leg - b.leg)
      .map(s => s.picks.join("-"))
      .join(" / ");

    rows.push({
      gameDate: round.gameDate,
      track: fullGame.races[0]?.track?.name ?? "—",
      winners,
      budget: budgetKr,
      rows: snapshot.system.rows,
      costKr: snapshot.system.costKr,
      picks,
      hit: hit.fullHit,
      correctLegs: hit.correctLegs,
      payoutKr: hit.payoutAmountKr ?? 0,
      netKr: (hit.payoutAmountKr ?? 0) - snapshot.system.costKr,
    });
    process.stdout.write(".");
  }
  return rows;
}

async function main() {
  console.log(`Hämtar ${LIMIT} senaste DD-omgångar...\n`);
  const rounds = await collectDdRounds();
  if (!rounds.length) { console.error("Inga omgångar."); process.exit(1); }

  const allResults: Record<number, RoundRow[]> = {};

  for (const budget of BUDGETS) {
    console.log(`\nKör budget ${budget} kr...`);
    const rows = await runBudget(rounds, budget);
    allResults[budget] = rows;
    console.log("");
  }

  // Summering per budget
  console.log("\n======= RESULTAT: 1 SYSTEM MED OLIKA BUDGETAR =======\n");
  console.log("| Budget | Träffar | Spelat  | Utbetalat | Netto    | ROI     | Snitt/träff |");
  console.log("|--------|---------|---------|-----------|----------|---------|-------------|");

  for (const budget of BUDGETS) {
    const rows = allResults[budget]!;
    const totalCost = rows.reduce((s, r) => s + r.costKr, 0);
    const totalPayout = rows.reduce((s, r) => s + r.payoutKr, 0);
    const hits = rows.filter(r => r.hit).length;
    const netto = totalPayout - totalCost;
    const roi = (totalPayout / totalCost - 1) * 100;
    const avgPerHit = hits > 0 ? totalPayout / hits : 0;
    console.log(`| ${budget} kr   | ${hits}/100   | ${Math.round(totalCost)} kr | ${Math.round(totalPayout)} kr    | ${netto >= 0 ? "+" : ""}${Math.round(netto)} kr | ${roi.toFixed(1)}% | ${Math.round(avgPerHit)} kr      |`);
  }

  // Speciellt: 2 system à 60 kr (från befintlig backtest)
  const s1Rows = allResults[60]!;
  console.log("\n======= JÄMFÖRELSE: 2×60 kr (dual) VS 1×120 kr VS 1×150 kr =======\n");

  // Simulera dual (Rad1 + Rad2) som samma insats som 120kr
  // Vi kan inte simulera Rad2 utan att köra det, men vi vet:
  // - 2×60 kr = 120 kr totalt = 12000 kr spelat
  // - 1×120 kr = 12000 kr spelat
  // - 1×150 kr = 15000 kr spelat

  const b60 = allResults[60]!;
  const b120 = allResults[120]!;
  const b150 = allResults[150]!;

  const summarize = (rows: RoundRow[], label: string) => {
    const totalCost = rows.reduce((s, r) => s + r.costKr, 0);
    const totalPayout = rows.reduce((s, r) => s + r.payoutKr, 0);
    const hits = rows.filter(r => r.hit).length;
    const netto = totalPayout - totalCost;
    const roi = (totalPayout / totalCost - 1) * 100;
    const hitRate = (hits / rows.length * 100).toFixed(1);
    return { label, hits, totalCost, totalPayout, netto, roi, hitRate };
  };

  const s60 = summarize(b60, "1 system à 60 kr");
  const s120 = summarize(b120, "1 system à 120 kr");
  const s150 = summarize(b150, "1 system à 150 kr");

  const items = [s60, s120, s150];
  for (const s of items) {
    console.log(`${s.label}:`);
    console.log(`  Träffar:    ${s.hits}/100 (${s.hitRate}%)`);
    console.log(`  Spelat:     ${Math.round(s.totalCost)} kr`);
    console.log(`  Utbetalat:  ${Math.round(s.totalPayout)} kr`);
    console.log(`  Netto:      ${s.netto >= 0 ? "+" : ""}${Math.round(s.netto)} kr`);
    console.log(`  ROI:        ${s.roi.toFixed(1)}%`);
    console.log("");
  }

  // Per omgång: jämför 120 kr vs 60 kr
  console.log("--- Skillnad per omgång (120 kr vs 60 kr) ---");
  const diffNetto = s120.netto - s60.netto;
  const extraCost = s120.totalCost - s60.totalCost;
  console.log(`Investerar ${Math.round(extraCost)} kr mer → ${diffNetto >= 0 ? "+" : ""}${Math.round(diffNetto)} kr skillnad i netto`);
  console.log(`Marginalavkastning på extrainsatsen: ${((s120.totalPayout - s60.totalPayout) / extraCost * 100 - 100).toFixed(1)}%`);

  console.log("\n--- Skillnad per omgång (150 kr vs 60 kr) ---");
  const diffNetto150 = s150.netto - s60.netto;
  const extraCost150 = s150.totalCost - s60.totalCost;
  console.log(`Investerar ${Math.round(extraCost150)} kr mer → ${diffNetto150 >= 0 ? "+" : ""}${Math.round(diffNetto150)} kr skillnad i netto`);
  console.log(`Marginalavkastning på extrainsatsen: ${((s150.totalPayout - s60.totalPayout) / extraCost150 * 100 - 100).toFixed(1)}%`);

  // Visa runder med skillnad i utfall (120 kr träffar som 60 kr missade)
  console.log("\n--- Omgångar där 120 kr träffar men 60 kr missade ---");
  for (let i = 0; i < b60.length; i++) {
    const r60 = b60[i]!, r120 = b120[i]!;
    if (r120.hit && !r60.hit) {
      console.log(`  ${r60.gameDate} (${r60.track}): vinnare ${r60.winners}, 120kr-picks=${r120.picks}, utbetalning=${Math.round(r120.payoutKr)} kr`);
    }
  }

  console.log("\n--- Omgångar där 150 kr träffar men 60 kr missade ---");
  for (let i = 0; i < b60.length; i++) {
    const r60 = b60[i]!, r150 = b150[i]!;
    if (r150.hit && !r60.hit) {
      console.log(`  ${r60.gameDate} (${r60.track}): vinnare ${r60.winners}, 150kr-picks=${r150.picks}, utbetalning=${Math.round(r150.payoutKr)} kr`);
    }
  }

  console.log("\n--- Omgångar där 60 kr träffar men 120 kr missade ---");
  for (let i = 0; i < b60.length; i++) {
    const r60 = b60[i]!, r120 = b120[i]!;
    if (r60.hit && !r120.hit) {
      console.log(`  ${r60.gameDate} (${r60.track}): vinnare ${r60.winners}, 60kr-payout=${Math.round(r60.payoutKr)} kr`);
    }
  }

  const outDir = resolve("v86", "output");
  mkdirSync(outDir, { recursive: true });
  const outPath = resolve(outDir, "dd-budget-comparison.json");
  writeFileSync(outPath, JSON.stringify({ generatedAt: new Date().toISOString(), rounds: rounds.length, results: allResults }, null, 2));
  console.log(`\nSparat: ${outPath}`);
}

main().catch(e => { console.error(e); process.exit(1); });
