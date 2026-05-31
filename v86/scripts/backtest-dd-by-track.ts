/**
 * Baktest 200 DD-omgångar med 150 kr-budget. Visar resultat per bana.
 * Kör: npx tsx v86/scripts/backtest-dd-by-track.ts
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { buildSystemHitSummary, extractTravResult } from "../../src/lib/trav-learning.server";
import { fileCacheBackend } from "../src/travsport/file-cache";
import { fetchCalendarDay, fetchGame, listAllowedGamesFromCalendar } from "../src/atg-api";
import { buildSnapshotFromGame, sanitizeHistoricalGameForPrematch } from "../src/pipeline";

const BUDGET_KR = 150;
const LIMIT = 400;
const LOOKBACK_DAYS = 1200;

function formatDate(d: Date) { return d.toISOString().slice(0, 10); }

async function collectDdRounds() {
  const rounds: { gameId: string; gameDate: string }[] = [];
  const seen = new Set<string>();
  const today = new Date();
  for (let back = 0; back <= LOOKBACK_DAYS && rounds.length < LIMIT; back++) {
    const date = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - back));
    const calendar = await fetchCalendarDay(formatDate(date)).catch(() => null);
    if (!calendar?.games) continue;
    const entries = listAllowedGamesFromCalendar(calendar.games).find(i => i.type === "dd")?.entries ?? [];
    for (const entry of entries) {
      if (rounds.length >= LIMIT) break;
      if (seen.has(entry.id)) continue;
      const game = await fetchGame(entry.id).catch(() => null);
      if (!game || game.status !== "results" || (game.races?.length ?? 0) < 2) continue;
      const gameDate = game.races[0]?.date?.slice(0, 10) ?? game.races[0]?.startTime?.slice(0, 10) ?? formatDate(date);
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
  costKr: number;
  payoutKr: number;
  netKr: number;
  hit: boolean;
  correctLegs: number;
  picks: string;
};

async function main() {
  console.log(`Hämtar ${LIMIT} senaste DD-omgångar (budget: ${BUDGET_KR} kr)...\n`);
  const rounds = await collectDdRounds();
  if (!rounds.length) { console.error("Inga omgångar."); process.exit(1); }
  console.log(`Hittade ${rounds.length} omgångar. Kör analys...\n`);

  const rows: RoundRow[] = [];

  for (const round of rounds) {
    const fullGame = await fetchGame(round.gameId);
    const prematchGame = sanitizeHistoricalGameForPrematch(fullGame);
    const snapshot = await buildSnapshotFromGame(prematchGame, {
      budgetKr: BUDGET_KR,
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
    const track = fullGame.races[0]?.track?.name ?? "Okänd";

    rows.push({
      gameDate: round.gameDate,
      track,
      winners,
      costKr: snapshot.system.costKr,
      payoutKr: hit.payoutAmountKr ?? 0,
      netKr: (hit.payoutAmountKr ?? 0) - snapshot.system.costKr,
      hit: hit.fullHit,
      correctLegs: hit.correctLegs,
      picks,
    });
    process.stdout.write(".");
  }
  console.log("\n");

  // Gruppera per bana
  const byTrack = new Map<string, RoundRow[]>();
  for (const row of rows) {
    if (!byTrack.has(row.track)) byTrack.set(row.track, []);
    byTrack.get(row.track)!.push(row);
  }

  type TrackStat = {
    track: string;
    rounds: number;
    hits: number;
    hitRate: number;
    totalCost: number;
    totalPayout: number;
    netKr: number;
    roi: number;
    avgPayout: number;
    maxPayout: number;
    oneHalf: number;
    zeroTwo: number;
    grade: string;
  };

  const stats: TrackStat[] = [];
  for (const [track, trackRows] of byTrack) {
    const hits = trackRows.filter(r => r.hit).length;
    const totalCost = trackRows.reduce((s, r) => s + r.costKr, 0);
    const totalPayout = trackRows.reduce((s, r) => s + r.payoutKr, 0);
    const netKr = totalPayout - totalCost;
    const roi = totalCost > 0 ? (totalPayout / totalCost - 1) * 100 : 0;
    const hitRate = hits / trackRows.length;
    const avgPayout = hits > 0 ? totalPayout / hits : 0;
    const maxPayout = Math.max(...trackRows.map(r => r.payoutKr), 0);
    const oneHalf = trackRows.filter(r => !r.hit && r.correctLegs === 1).length;
    const zeroTwo = trackRows.filter(r => r.correctLegs === 0).length;

    // Betygsätt: kombinera ROI, träffprocent och antal omgångar
    let grade = "C";
    if (trackRows.length >= 3) {
      if (roi >= 40 && hitRate >= 0.5) grade = "A+";
      else if (roi >= 25 && hitRate >= 0.45) grade = "A";
      else if (roi >= 15 && hitRate >= 0.40) grade = "B+";
      else if (roi >= 5 && hitRate >= 0.35) grade = "B";
      else if (roi >= 0 && hitRate >= 0.30) grade = "B-";
      else if (roi >= -15) grade = "C";
      else grade = "D";
    } else {
      grade = "?"; // för få omgångar
    }

    stats.push({ track, rounds: trackRows.length, hits, hitRate, totalCost, totalPayout, netKr, roi, avgPayout, maxPayout, oneHalf, zeroTwo, grade });
  }

  // Sortera: betyg → ROI → antal omgångar
  const gradeOrder = ["A+", "A", "B+", "B", "B-", "C", "D", "?"];
  stats.sort((a, b) => gradeOrder.indexOf(a.grade) - gradeOrder.indexOf(b.grade) || b.roi - a.roi || b.rounds - a.rounds);

  // Totalt
  const totalRounds = rows.length;
  const totalHits = rows.filter(r => r.hit).length;
  const totalCost = rows.reduce((s, r) => s + r.costKr, 0);
  const totalPayout = rows.reduce((s, r) => s + r.payoutKr, 0);
  const totalNet = totalPayout - totalCost;
  const totalRoi = (totalPayout / totalCost - 1) * 100;

  console.log(`=== DD ${BUDGET_KR} KR — RESULTAT PER BANA (${totalRounds} omgångar) ===\n`);
  console.log(`Totalt: ${totalHits}/${totalRounds} träffar (${(totalHits/totalRounds*100).toFixed(0)}%), netto ${totalNet >= 0 ? "+" : ""}${Math.round(totalNet)} kr, ROI ${totalRoi.toFixed(1)}%\n`);

  console.log("| Betyg | Bana              | Omg | Träff | Träff% | Netto    | ROI    | Snitt/träff | Bästa  | 1/2 | 0/2 |");
  console.log("|-------|-------------------|-----|-------|--------|----------|--------|-------------|--------|-----|-----|");

  for (const s of stats) {
    const netStr = `${s.netKr >= 0 ? "+" : ""}${Math.round(s.netKr)} kr`;
    const roiStr = `${s.roi.toFixed(1)}%`;
    const trackPad = s.track.padEnd(17).slice(0, 17);
    const hitPct = `${(s.hitRate * 100).toFixed(0)}%`;
    const avgPay = s.hits > 0 ? `${Math.round(s.avgPayout)} kr` : "—";
    const maxPay = s.maxPayout > 0 ? `${Math.round(s.maxPayout)} kr` : "—";
    console.log(`| ${s.grade.padEnd(5)} | ${trackPad} | ${String(s.rounds).padStart(3)} | ${String(s.hits).padStart(5)} | ${hitPct.padStart(6)} | ${netStr.padStart(8)} | ${roiStr.padStart(6)} | ${avgPay.padStart(11)} | ${maxPay.padStart(6)} | ${String(s.oneHalf).padStart(3)} | ${String(s.zeroTwo).padStart(3)} |`);
  }

  // Topplista: bästa banor (≥3 omgångar)
  const qualified = stats.filter(s => s.rounds >= 3);
  const top5 = [...qualified].sort((a, b) => b.roi - a.roi).slice(0, 5);
  const bottom5 = [...qualified].sort((a, b) => a.roi - b.roi).slice(0, 5);

  console.log("\n### BÄSTA 5 BANOR (ROI)");
  for (const s of top5) {
    console.log(`  ${s.grade} ${s.track}: ${s.hits}/${s.rounds} träffar, ROI ${s.roi.toFixed(1)}%, netto ${s.netKr >= 0 ? "+" : ""}${Math.round(s.netKr)} kr`);
  }

  console.log("\n### SÄMSTA 5 BANOR (ROI)");
  for (const s of bottom5) {
    console.log(`  ${s.grade} ${s.track}: ${s.hits}/${s.rounds} träffar, ROI ${s.roi.toFixed(1)}%, netto ${s.netKr >= 0 ? "+" : ""}${Math.round(s.netKr)} kr`);
  }

  const outDir = resolve("v86", "output");
  mkdirSync(outDir, { recursive: true });
  const outPath = resolve(outDir, "dd-track-analysis.json");
  writeFileSync(outPath, JSON.stringify({ generatedAt: new Date().toISOString(), budgetKr: BUDGET_KR, rounds: totalRounds, stats, rows }, null, 2));
  console.log(`\nSparat: ${outPath}`);
}

main().catch(e => { console.error(e); process.exit(1); });
