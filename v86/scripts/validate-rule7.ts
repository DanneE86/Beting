/**
 * Validerar rule7 mot rule6 på senaste 20 lördags-V85 omgångar.
 * Kör: npx tsx v86/scripts/validate-rule7.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fetchCalendarDay, fetchGame, listAllowedGamesFromCalendar } from "../src/atg-api";
import { buildSnapshotFromGame, sanitizeHistoricalGameForPrematch } from "../src/pipeline";
import { fileCacheBackend } from "../src/travsport/file-cache";
import { buildSystemHitSummary, extractTravResult } from "../../src/lib/trav-learning.server";
import type { TravRuleId } from "../src/types";

const MAX_ROUNDS = 20;
const LOOKBACK_DAYS = 500;

type Round = { gameId: string; gameDate: string };
type RuleRow = { gameDate: string; ruleId: string; costKr: number; payoutKr: number; netKr: number; correctLegs: number; fullHit: boolean; spikeCount: number; rows: number };

function isSaturday(d: Date) { return d.getUTCDay() === 6; }
function fmtDate(d: Date) { return d.toISOString().slice(0, 10); }

async function collectRounds(): Promise<Round[]> {
  const rounds: Round[] = [];
  const seen = new Set<string>();
  const today = new Date();
  for (let daysBack = 0; daysBack <= LOOKBACK_DAYS && rounds.length < MAX_ROUNDS; daysBack++) {
    const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - daysBack));
    if (!isSaturday(d)) continue;
    const dateIso = fmtDate(d);
    const cal = await fetchCalendarDay(dateIso).catch(() => null);
    if (!cal?.games) continue;
    const entries = listAllowedGamesFromCalendar(cal.games).find(g => g.type === "V85")?.entries ?? [];
    for (const entry of entries) {
      if (rounds.length >= MAX_ROUNDS || seen.has(entry.id)) continue;
      const game = await fetchGame(entry.id).catch(() => null);
      if (!game || game.status !== "results") continue;
      const startRaw = game.races[0]?.date ?? game.races[0]?.startTime ?? dateIso;
      const startDate = new Date(startRaw);
      if (!isSaturday(startDate)) continue;
      rounds.push({ gameId: game.id, gameDate: fmtDate(startDate) });
      seen.add(game.id);
    }
  }
  return rounds.sort((a, b) => a.gameDate.localeCompare(b.gameDate));
}

async function evalRule(round: Round, ruleId: TravRuleId): Promise<RuleRow> {
  const fullGame = await fetchGame(round.gameId);
  const prematch = sanitizeHistoricalGameForPrematch(fullGame);
  const snapshot = await buildSnapshotFromGame(prematch, {
    ruleId,
    includeAndelsspel: false,
    includeTravsport: true,
    travsportDbCache: fileCacheBackend,
    travsportAllowStaleCache: true,
  });
  const resolved = extractTravResult(fullGame);
  const hit = buildSystemHitSummary(snapshot.system, resolved);
  const payoutKr = hit.payoutAmountKr ?? 0;
  return {
    gameDate: round.gameDate,
    ruleId,
    costKr: snapshot.system.costKr,
    payoutKr,
    netKr: payoutKr - snapshot.system.costKr,
    correctLegs: hit.correctLegs,
    fullHit: hit.fullHit,
    spikeCount: snapshot.system.selections.filter(s => s.type !== "gardering").length,
    rows: snapshot.system.rows,
  };
}

function summarize(rows: RuleRow[], label: string) {
  const totalCost = rows.reduce((s, r) => s + r.costKr, 0);
  const totalPayout = rows.reduce((s, r) => s + r.payoutKr, 0);
  const net = totalPayout - totalCost;
  const monthly = new Map<string, number>();
  rows.forEach(r => monthly.set(r.gameDate.slice(0, 7), (monthly.get(r.gameDate.slice(0, 7)) ?? 0) + r.netKr));
  const plusMonths = [...monthly.values()].filter(v => v > 0).length;
  const hitRate = rows.filter(r => r.payoutKr > 0).length / rows.length;
  const sixPlus = rows.filter(r => r.correctLegs >= 6).length / rows.length;
  const avgSpikes = rows.reduce((s, r) => s + r.spikeCount, 0) / rows.length;
  const avgRows = rows.reduce((s, r) => s + r.rows, 0) / rows.length;
  const avgCost = totalCost / rows.length;

  console.log(`\n=== ${label} ===`);
  console.log(`  Omgångar:     ${rows.length}`);
  console.log(`  Snittbudget:  ${Math.round(avgCost)} kr/omg`);
  console.log(`  Snitt rader:  ${avgRows.toFixed(1)} rader/omg`);
  console.log(`  Snitt spikar: ${avgSpikes.toFixed(1)}/omg`);
  console.log(`  ROI:          ${((net / totalCost) * 100).toFixed(1)}%`);
  console.log(`  Netto totalt: ${Math.round(net).toLocaleString("sv-SE")} kr`);
  console.log(`  Träffrate:    ${(hitRate * 100).toFixed(0)}% (ngn utdelning)`);
  console.log(`  6+ rätt:      ${(sixPlus * 100).toFixed(0)}% av omgångarna`);
  console.log(`  Månadsplus:   ${plusMonths}/${monthly.size} månader`);
  console.log("  Månadsdetalj:");
  [...monthly.entries()].sort().forEach(([m, v]) => {
    console.log(`    ${m}: ${v >= 0 ? "+" : ""}${Math.round(v).toLocaleString("sv-SE")} kr`);
  });
  console.log("  Ben-fördelning:");
  const dist = new Map<number, number>();
  rows.forEach(r => dist.set(r.correctLegs, (dist.get(r.correctLegs) ?? 0) + 1));
  [...dist.entries()].sort((a, b) => a[0] - b[0]).forEach(([legs, cnt]) => {
    console.log(`    ${legs}/8 rätt: ${cnt} omg (${Math.round(cnt / rows.length * 100)}%)`);
  });
  return { net, totalCost, hitRate, sixPlus, plusMonths, totalMonths: monthly.size, avgSpikes, avgRows, avgCost };
}

async function main() {
  console.log("Hämtar 20 lördags-V85 omgångar...");
  const rounds = await collectRounds();
  console.log(`Hittade ${rounds.length} omgångar: ${rounds[0]?.gameDate} → ${rounds[rounds.length-1]?.gameDate}\n`);

  const rule6Rows: RuleRow[] = [];
  const rule7Rows: RuleRow[] = [];

  for (let i = 0; i < rounds.length; i++) {
    const round = rounds[i];
    process.stdout.write(`[${i+1}/${rounds.length}] ${round.gameDate}... `);
    const [r6, r7] = await Promise.all([evalRule(round, "rule6"), evalRule(round, "rule7")]);
    rule6Rows.push(r6);
    rule7Rows.push(r7);
    console.log(`rule6: ${r6.correctLegs}/8 rätt ${r6.spikeCount}spik ${r6.rows}rad | rule7: ${r7.correctLegs}/8 rätt ${r7.spikeCount}spik ${r7.rows}rad`);
  }

  const s6 = summarize(rule6Rows, "RULE6 (gammal standard)");
  const s7 = summarize(rule7Rows, "RULE7 (ny månadsregel)");

  console.log("\n=== JÄMFÖRELSE rule6 vs rule7 ===");
  console.log(`  Snitt spikar:  rule6=${s6.avgSpikes.toFixed(1)} → rule7=${s7.avgSpikes.toFixed(1)} (mål: max 2)`);
  console.log(`  Snitt rader:   rule6=${s6.avgRows.toFixed(1)} → rule7=${s7.avgRows.toFixed(1)}`);
  console.log(`  Snitt budget:  rule6=${Math.round(s6.avgCost)} kr → rule7=${Math.round(s7.avgCost)} kr`);
  console.log(`  Träffrate:     rule6=${(s6.hitRate*100).toFixed(0)}% → rule7=${(s7.hitRate*100).toFixed(0)}%`);
  console.log(`  6+ rätt:       rule6=${(s6.sixPlus*100).toFixed(0)}% → rule7=${(s7.sixPlus*100).toFixed(0)}%`);
  console.log(`  Månadsplus:    rule6=${s6.plusMonths}/${s6.totalMonths} → rule7=${s7.plusMonths}/${s7.totalMonths}`);
  console.log(`  Netto totalt:  rule6=${Math.round(s6.net).toLocaleString("sv-SE")} kr → rule7=${Math.round(s7.net).toLocaleString("sv-SE")} kr`);

  const outDir = resolve("v86", "output");
  mkdirSync(outDir, { recursive: true });
  writeFileSync(resolve(outDir, "rule7-validation.json"), JSON.stringify({ generatedAt: new Date().toISOString(), rounds, rule6: rule6Rows, rule7: rule7Rows }, null, 2), "utf-8");
  console.log("\nSparade: v86/output/rule7-validation.json");
}

main().catch(e => { console.error(e); process.exit(1); });
