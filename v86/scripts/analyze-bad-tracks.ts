/**
 * Djupanalys av problembanor vs toppbanor.
 * Kör: npx tsx v86/scripts/analyze-bad-tracks.ts
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const data = JSON.parse(readFileSync(resolve("v86/output/dd-track-analysis.json"), "utf-8"));

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

const rows: RoundRow[] = data.rows;

const BAD_TRACKS  = ["Gävle", "Bergsåker", "Boden", "Örebro", "Romme"];
const GOOD_TRACKS = ["Axevalla", "Bjerke", "Färjestad", "Eskilstuna", "Jägersro"];

function parsePicks(picksStr: string): [number[], number[]] {
  const parts = picksStr.split(" / ");
  const parse = (s: string) => s.split("-").map(Number).filter(n => !isNaN(n));
  return [parse(parts[0] ?? ""), parse(parts[1] ?? "")];
}

function parseWinners(s: string): [number, number] {
  const p = s.split("-");
  return [Number(p[0]), Number(p[1])];
}

function analyzeGroup(label: string, trackRows: RoundRow[]) {
  if (!trackRows.length) return;

  const hits = trackRows.filter(r => r.hit);
  const misses = trackRows.filter(r => !r.hit);
  const totalCost = trackRows.reduce((s, r) => s + r.costKr, 0);
  const totalPayout = trackRows.reduce((s, r) => s + r.payoutKr, 0);
  const roi = (totalPayout / totalCost - 1) * 100;

  // För varje omgång: var vinnaren i vår lista och på vilken position?
  const leg1Covered: number[] = [];
  const leg2Covered: number[] = [];
  const leg1WinnerRank: number[] = [];
  const leg2WinnerRank: number[] = [];
  const leg1PickCount: number[] = [];
  const leg2PickCount: number[] = [];
  const winnerNumbers1: number[] = [];
  const winnerNumbers2: number[] = [];
  let missLeg1Only = 0, missLeg2Only = 0, missBoth = 0;

  for (const r of trackRows) {
    const [picks1, picks2] = parsePicks(r.picks);
    const [w1, w2] = parseWinners(r.winners);
    const has1 = picks1.includes(w1);
    const has2 = picks2.includes(w2);
    leg1Covered.push(has1 ? 1 : 0);
    leg2Covered.push(has2 ? 1 : 0);
    leg1PickCount.push(picks1.length);
    leg2PickCount.push(picks2.length);
    winnerNumbers1.push(w1);
    winnerNumbers2.push(w2);

    const rank1 = picks1.indexOf(w1) >= 0 ? picks1.indexOf(w1) + 1 : 999;
    const rank2 = picks2.indexOf(w2) >= 0 ? picks2.indexOf(w2) + 1 : 999;
    leg1WinnerRank.push(rank1);
    leg2WinnerRank.push(rank2);

    if (!r.hit) {
      if (!has1 && !has2) missBoth++;
      else if (!has1) missLeg2Only++;
      else if (!has2) missLeg1Only++;
    }
  }

  const leg1CovPct = leg1Covered.reduce((a,b)=>a+b,0)/trackRows.length*100;
  const leg2CovPct = leg2Covered.reduce((a,b)=>a+b,0)/trackRows.length*100;
  const avgL1Picks = leg1PickCount.reduce((a,b)=>a+b,0)/trackRows.length;
  const avgL2Picks = leg2PickCount.reduce((a,b)=>a+b,0)/trackRows.length;
  const avgW1 = winnerNumbers1.reduce((a,b)=>a+b,0)/trackRows.length;
  const avgW2 = winnerNumbers2.reduce((a,b)=>a+b,0)/trackRows.length;
  const highNum1 = winnerNumbers1.filter(n=>n>=8).length;
  const highNum2 = winnerNumbers2.filter(n=>n>=8).length;
  const avgPayout = hits.length > 0 ? totalPayout / hits.length : 0;

  // Rankfördelning för vinnare
  const rank1Dist = [1,2,3,4,5].map(r => ({ r, count: leg1WinnerRank.filter(x=>x===r).length }));
  const rank2Dist = [1,2,3,4,5].map(r => ({ r, count: leg2WinnerRank.filter(x=>x===r).length }));
  const notInList1 = leg1WinnerRank.filter(x=>x===999).length;
  const notInList2 = leg2WinnerRank.filter(x=>x===999).length;

  // Låga utbetalningar vid träff
  const lowPayHits = hits.filter(r => r.payoutKr < r.costKr);
  const subOptimalHits = hits.filter(r => r.payoutKr < 200);

  console.log(`\n${"=".repeat(60)}`);
  console.log(`${label} (${trackRows.length} omgångar)`);
  console.log(`${"=".repeat(60)}`);
  console.log(`Träffar: ${hits.length}/${trackRows.length} (${(hits.length/trackRows.length*100).toFixed(0)}%)  ROI: ${roi.toFixed(1)}%  Snitt/träff: ${Math.round(avgPayout)} kr`);
  console.log(`Leg1 täckning: ${leg1CovPct.toFixed(0)}%  Leg2 täckning: ${leg2CovPct.toFixed(0)}%`);
  console.log(`Avg picks leg1: ${avgL1Picks.toFixed(1)}  Avg picks leg2: ${avgL2Picks.toFixed(1)}`);
  console.log(`Missar: leg1 saknas=${missLeg1Only}, leg2 saknas=${missLeg2Only}, båda saknas=${missBoth}`);
  console.log(`Vinnarnummer: leg1 avg=${avgW1.toFixed(1)} (≥8: ${highNum1}/${trackRows.length}), leg2 avg=${avgW2.toFixed(1)} (≥8: ${highNum2}/${trackRows.length})`);
  console.log(`Låga träffar (<insats): ${lowPayHits.length}  Under 200kr: ${subOptimalHits.length}/${hits.length}`);

  console.log(`Leg1 vinnare rank: ${rank1Dist.map(d=>`R${d.r}:${d.count}`).join(" ")} ej i lista:${notInList1}`);
  console.log(`Leg2 vinnare rank: ${rank2Dist.map(d=>`R${d.r}:${d.count}`).join(" ")} ej i lista:${notInList2}`);
}

// Kör analys
const badRows = rows.filter(r => BAD_TRACKS.includes(r.track));
const goodRows = rows.filter(r => GOOD_TRACKS.includes(r.track));

console.log("\n====== JÄMFÖRELSE: BRA BANOR vs DÅLIGA BANOR ======");
analyzeGroup("BÄSTA BANOR (Axevalla, Bjerke, Färjestad, Eskilstuna, Jägersro)", goodRows);
analyzeGroup("SÄMSTA BANOR (Gävle, Bergsåker, Boden, Örebro, Romme)", badRows);

// Per dålig bana
console.log("\n\n====== DETALJ PER DÅLIG BANA ======");
for (const track of BAD_TRACKS) {
  const trackRows = rows.filter(r => r.track === track);
  analyzeGroup(track.toUpperCase(), trackRows);
}

// Spesifikt: Romme träffar men låga utbetalningar
console.log("\n\n====== ROMME: alla träffar ======");
for (const r of rows.filter(r => r.track === "Romme" && r.hit)) {
  console.log(`  ${r.gameDate}: ${r.winners} → ${Math.round(r.payoutKr)} kr (picks: ${r.picks})`);
}

console.log("\n\n====== GÄVLE: alla omgångar ======");
for (const r of rows.filter(r => r.track === "Gävle")) {
  const [p1, p2] = parsePicks(r.picks);
  const [w1, w2] = parseWinners(r.winners);
  const has1 = p1.includes(w1), has2 = p2.includes(w2);
  const status = r.hit ? `TRÄFF ${Math.round(r.payoutKr)} kr` : `MISS (leg1:${has1?"✓":"✗"} leg2:${has2?"✓":"✗"})`;
  console.log(`  ${r.gameDate}: vinnare ${r.winners}  picks: ${r.picks}  → ${status}`);
}

console.log("\n\n====== BERGSÅKER: alla omgångar ======");
for (const r of rows.filter(r => r.track === "Bergsåker")) {
  const [p1, p2] = parsePicks(r.picks);
  const [w1, w2] = parseWinners(r.winners);
  const has1 = p1.includes(w1), has2 = p2.includes(w2);
  const status = r.hit ? `TRÄFF ${Math.round(r.payoutKr)} kr` : `MISS (leg1:${has1?"✓":"✗"} leg2:${has2?"✓":"✗"})`;
  console.log(`  ${r.gameDate}: vinnare ${r.winners}  picks: ${r.picks}  → ${status}`);
}
