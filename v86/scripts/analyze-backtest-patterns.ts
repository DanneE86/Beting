/**
 * Analyserar mönster i backtest-JSON för att hitta förbättringar.
 * Kör: npx tsx v86/scripts/analyze-backtest-patterns.ts
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const json = JSON.parse(
  readFileSync(resolve("v86/output/dd-dual-rows-backtest.json"), "utf-8"),
);

type Row = {
  gameDate: string;
  track: string;
  winners: string;
  system1Leg1: string;
  system1Leg2: string;
  system1Hit: boolean;
  system1CorrectLegs: number;
  system1PayoutKr: number;
  system1NetKr: number;
  system2Leg1: string;
  system2Leg2: string;
  system2Hit: boolean;
  system2CorrectLegs: number;
  system2PayoutKr: number;
  system2NetKr: number;
  sharedLeg1: number;
  sharedLeg2: number;
};

const rows: Row[] = json.rows;

function parsePicks(s: string): number[] {
  return s.split(",").map((x) => Number(x.trim())).filter((n) => !Number.isNaN(n));
}

function parseWinners(s: string): [number, number] {
  const parts = s.split("-");
  return [Number(parts[0]), Number(parts[1])];
}

// Classify each round
type Analysis = {
  winnerLeg1: number;
  winnerLeg2: number;
  s1Leg1: number[];
  s1Leg2: number[];
  s2Leg1: number[];
  s2Leg2: number[];
  s1HasLeg1: boolean;
  s1HasLeg2: boolean;
  s2HasLeg1: boolean;
  s2HasLeg2: boolean;
  anyHasLeg1: boolean;
  anyHasLeg2: boolean;
  winnerRankS1Leg1: number; // position in s1Leg1 picks (1-indexed, 999 = not in)
  winnerRankS1Leg2: number;
  s1Hit: boolean;
  s2Hit: boolean;
  bothHit: boolean;
  noneHit: boolean;
  category: "both" | "only_s1" | "only_s2" | "none";
};

const analyses: Analysis[] = rows.map((row) => {
  const [w1, w2] = parseWinners(row.winners);
  const s1l1 = parsePicks(row.system1Leg1);
  const s1l2 = parsePicks(row.system1Leg2);
  const s2l1 = parsePicks(row.system2Leg1);
  const s2l2 = parsePicks(row.system2Leg2);

  const s1HasLeg1 = s1l1.includes(w1);
  const s1HasLeg2 = s1l2.includes(w2);
  const s2HasLeg1 = s2l1.includes(w1);
  const s2HasLeg2 = s2l2.includes(w2);
  const anyHasLeg1 = s1HasLeg1 || s2HasLeg1;
  const anyHasLeg2 = s1HasLeg2 || s2HasLeg2;

  const winnerRankS1Leg1 = s1l1.indexOf(w1) >= 0 ? s1l1.indexOf(w1) + 1 : 999;
  const winnerRankS1Leg2 = s1l2.indexOf(w2) >= 0 ? s1l2.indexOf(w2) + 1 : 999;

  const bothHit = row.system1Hit && row.system2Hit;
  const noneHit = !row.system1Hit && !row.system2Hit;
  const category = bothHit ? "both" : row.system1Hit ? "only_s1" : row.system2Hit ? "only_s2" : "none";

  return { winnerLeg1: w1, winnerLeg2: w2, s1Leg1: s1l1, s1Leg2: s1l2, s2Leg1: s2l1, s2Leg2: s2l2, s1HasLeg1, s1HasLeg2, s2HasLeg1, s2HasLeg2, anyHasLeg1, anyHasLeg2, winnerRankS1Leg1, winnerRankS1Leg2, s1Hit: row.system1Hit, s2Hit: row.system2Hit, bothHit, noneHit, category };
});

console.log("=== BAKTEST 100 OMGÅNGAR – MÖNSTERANALYS ===\n");

// 1. Övergripande träffanalys
const s1Hits = analyses.filter((a) => a.s1Hit).length;
const s2Hits = analyses.filter((a) => a.s2Hit).length;
const bothHits = analyses.filter((a) => a.bothHit).length;
const noneHits = analyses.filter((a) => a.noneHit).length;
const atLeastOneHit = analyses.filter((a) => a.s1Hit || a.s2Hit).length;

console.log("## 1. Träfffördelning");
console.log(`  Rad 1 träff:           ${s1Hits}/100 (${s1Hits}%)`);
console.log(`  Rad 2 träff:           ${s2Hits}/100 (${s2Hits}%)`);
console.log(`  Båda träff:            ${bothHits}/100`);
console.log(`  Minst en träff:        ${atLeastOneHit}/100`);
console.log(`  Ingen träff:           ${noneHits}/100\n`);

// 2. Täckningsanalys – hade vi rätt häst i listan?
const missesWithLeg1Covered = analyses.filter((a) => a.noneHit && a.anyHasLeg1).length;
const missesWithLeg2Covered = analyses.filter((a) => a.noneHit && a.anyHasLeg2).length;
const missesWithBothCovered = analyses.filter((a) => a.noneHit && a.anyHasLeg1 && a.anyHasLeg2).length;
const missesWithNoneCovered = analyses.filter((a) => a.noneHit && !a.anyHasLeg1 && !a.anyHasLeg2).length;
const missesWithOnlyLeg1 = analyses.filter((a) => a.noneHit && a.anyHasLeg1 && !a.anyHasLeg2).length;
const missesWithOnlyLeg2 = analyses.filter((a) => a.noneHit && !a.anyHasLeg1 && a.anyHasLeg2).length;

console.log("## 2. Täckningsanalys vid miss (noneHit)");
console.log(`  Lopp utan träff:           ${noneHits}`);
console.log(`  - Hade leg1-vinnaren:      ${missesWithLeg1Covered} (${Math.round(missesWithLeg1Covered/noneHits*100)}%)`);
console.log(`  - Hade leg2-vinnaren:      ${missesWithLeg2Covered} (${Math.round(missesWithLeg2Covered/noneHits*100)}%)`);
console.log(`  - Hade båda (men ingen hit): ${missesWithBothCovered} (Kombinationsfel!)`);
console.log(`  - Hade leg1 men ej leg2:  ${missesWithOnlyLeg1}`);
console.log(`  - Hade leg2 men ej leg1:  ${missesWithOnlyLeg2}`);
console.log(`  - Hade ingen av dem:       ${missesWithNoneCovered} (äkta skrällar)\n`);

// 3. S1: vilken position hade vinnaren i vår lista?
console.log("## 3. Vinnarhäst position i Rad 1 plocklista");
const leg1Ranks = analyses.map((a) => a.winnerRankS1Leg1);
const leg2Ranks = analyses.map((a) => a.winnerRankS1Leg2);

const rankDist1 = [1, 2, 3, 999].map((r) => ({
  rank: r,
  count: leg1Ranks.filter((x) => x === r).length,
}));
const rankDist2 = [1, 2, 3, 999].map((r) => ({
  rank: r,
  count: leg2Ranks.filter((x) => x === r).length,
}));

console.log("  Leg 1 vinnare vid rank:");
for (const d of rankDist1) {
  const label = d.rank === 999 ? "ej i listan" : `rank ${d.rank}`;
  console.log(`    ${label}: ${d.count}/100`);
}
console.log("  Leg 2 vinnare vid rank:");
for (const d of rankDist2) {
  const label = d.rank === 999 ? "ej i listan" : `rank ${d.rank}`;
  console.log(`    ${label}: ${d.count}/100`);
}
console.log();

// 4. Vinnarnummer-fördelning
const allLeg1Winners = analyses.map((a) => a.winnerLeg1);
const allLeg2Winners = analyses.map((a) => a.winnerLeg2);
const avg1 = allLeg1Winners.reduce((a, b) => a + b, 0) / allLeg1Winners.length;
const avg2 = allLeg2Winners.reduce((a, b) => a + b, 0) / allLeg2Winners.length;
const highNum1 = allLeg1Winners.filter((n) => n >= 8).length;
const highNum2 = allLeg2Winners.filter((n) => n >= 8).length;

console.log("## 4. Vinnarnummer-statistik");
console.log(`  Leg 1: avg nummer ${avg1.toFixed(1)}, nummer ≥8: ${highNum1}/100`);
console.log(`  Leg 2: avg nummer ${avg2.toFixed(1)}, nummer ≥8: ${highNum2}/100\n`);

// 5. Systemstruktur – hur ser picks ut (storlek per ben)?
const s1L1Sizes = analyses.map((a) => a.s1Leg1.length);
const s1L2Sizes = analyses.map((a) => a.s1Leg2.length);
const s2L1Sizes = analyses.map((a) => a.s2Leg1.length);
const s2L2Sizes = analyses.map((a) => a.s2Leg2.length);

const countBy = (arr: number[], v: number) => arr.filter((x) => x === v).length;

console.log("## 5. Systemstruktur (picks per ben)");
console.log("  Rad 1 Leg1: " + [1,2,3,4].map((v) => `${v}st: ${countBy(s1L1Sizes, v)}`).join(", "));
console.log("  Rad 1 Leg2: " + [1,2,3,4].map((v) => `${v}st: ${countBy(s1L2Sizes, v)}`).join(", "));
console.log("  Rad 2 Leg1: " + [1,2,3,4].map((v) => `${v}st: ${countBy(s2L1Sizes, v)}`).join(", "));
console.log("  Rad 2 Leg2: " + [1,2,3,4].map((v) => `${v}st: ${countBy(s2L2Sizes, v)}`).join(", "));

// Träffprocent per strukturkombination
const configs: Record<string, { hits: number; total: number }> = {};
for (let i = 0; i < analyses.length; i++) {
  const key = `${s1L1Sizes[i]}x${s1L2Sizes[i]}`;
  if (!configs[key]) configs[key] = { hits: 0, total: 0 };
  configs[key].total++;
  if (analyses[i].s1Hit) configs[key].hits++;
}
console.log("\n  Rad 1 träff per konfiguration:");
for (const [k, v] of Object.entries(configs).sort((a, b) => b[1].total - a[1].total)) {
  console.log(`    ${k}: ${v.hits}/${v.total} (${Math.round(v.hits/v.total*100)}%)`);
}
console.log();

// 6. Vad är problemet i de 1/2-fallen?
const s1Half = analyses.filter((a) => !a.s1Hit && a.s1HasLeg1 !== a.s1HasLeg2);
const s1HalfGotLeg1 = s1Half.filter((a) => a.s1HasLeg1 && !a.s1HasLeg2).length;
const s1HalfGotLeg2 = s1Half.filter((a) => !a.s1HasLeg1 && a.s1HasLeg2).length;

console.log("## 6. Analys av 1/2-miss (Rad 1)");
console.log(`  Total 1/2: ${s1Half.length}`);
console.log(`  - Hade Leg1 men missade Leg2: ${s1HalfGotLeg1}`);
console.log(`  - Hade Leg2 men missade Leg1: ${s1HalfGotLeg2}`);

// Hur stor var leg2 listan när vi missade den?
const missedLeg2Sizes = analyses
  .filter((a) => !a.s1Hit && a.s1HasLeg1 && !a.s1HasLeg2)
  .map((a) => a.s1Leg2.length);
const missedLeg1Sizes = analyses
  .filter((a) => !a.s1Hit && !a.s1HasLeg1 && a.s1HasLeg2)
  .map((a) => a.s1Leg1.length);

if (missedLeg2Sizes.length) {
  const avg = missedLeg2Sizes.reduce((a, b) => a + b, 0) / missedLeg2Sizes.length;
  console.log(`  - Avg leg2-listestorlek vid "hade leg1 men ej leg2": ${avg.toFixed(1)}`);
}
if (missedLeg1Sizes.length) {
  const avg = missedLeg1Sizes.reduce((a, b) => a + b, 0) / missedLeg1Sizes.length;
  console.log(`  - Avg leg1-listestorlek vid "hade leg2 men ej leg1": ${avg.toFixed(1)}`);
}
console.log();

// 7. ROI per kategori
const payouts1 = rows.map((r) => r.system1PayoutKr);
const costs = rows.map((r) => r.system1NetKr + r.system1PayoutKr === 0 ? 60 : r.system1PayoutKr - r.system1NetKr);
const totalPayout1 = payouts1.reduce((a, b) => a + b, 0);
const totalCost1 = 60 * 100;

console.log("## 7. Finansiell analys");
console.log(`  Rad 1: inspelade ${Math.round(totalPayout1)} kr / spelat ${totalCost1} kr = ROI ${((totalPayout1/totalCost1-1)*100).toFixed(1)}%`);

const bigHits1 = rows.filter((r) => r.system1PayoutKr > 500);
const smallHits1 = rows.filter((r) => r.system1PayoutKr > 0 && r.system1PayoutKr <= 500);
console.log(`  Rad 1 stora träffar (>500kr): ${bigHits1.length}, bidrag: ${Math.round(bigHits1.reduce((s,r)=>s+r.system1PayoutKr,0))} kr`);
console.log(`  Rad 1 små träffar (≤500kr): ${smallHits1.length}, bidrag: ${Math.round(smallHits1.reduce((s,r)=>s+r.system1PayoutKr,0))} kr`);
console.log(`  Rad 1 unprofitable träffar (<60kr): ${rows.filter(r => r.system1PayoutKr > 0 && r.system1PayoutKr < 60).length}`);

const totalPayout2 = rows.reduce((s,r) => s+r.system2PayoutKr, 0);
console.log(`\n  Rad 2: inspelade ${Math.round(totalPayout2)} kr / spelat ${totalCost1} kr = ROI ${((totalPayout2/totalCost1-1)*100).toFixed(1)}%`);
const bigHits2 = rows.filter((r) => r.system2PayoutKr > 500);
const smallHits2 = rows.filter((r) => r.system2PayoutKr > 0 && r.system2PayoutKr <= 500);
console.log(`  Rad 2 stora träffar (>500kr): ${bigHits2.length}, bidrag: ${Math.round(bigHits2.reduce((s,r)=>s+r.system2PayoutKr,0))} kr`);
console.log(`  Rad 2 små träffar (≤500kr): ${smallHits2.length}, bidrag: ${Math.round(smallHits2.reduce((s,r)=>s+r.system2PayoutKr,0))} kr`);
console.log();

// 8. Specifika missed combos för att förstå vinnarhästens rank i vår ordning
console.log("## 8. Totala täckning – vinnare i System 1 lista?");
const s1Leg1Covered = analyses.filter(a => a.s1HasLeg1).length;
const s1Leg2Covered = analyses.filter(a => a.s1HasLeg2).length;
const s1BothCovered = analyses.filter(a => a.s1HasLeg1 && a.s1HasLeg2).length;
console.log(`  Leg1-vinnare i S1 lista: ${s1Leg1Covered}/100`);
console.log(`  Leg2-vinnare i S1 lista: ${s1Leg2Covered}/100`);
console.log(`  Båda vinnare i S1 lista: ${s1BothCovered}/100 (borde = träffar = ${s1Hits})`);
console.log(`  Kombinations-miss (hade båda men missade): ${s1BothCovered - s1Hits}`);
console.log();

// 9. Payout-distribution för träffar
const hits = rows.filter(r => r.system1Hit || r.system2Hit);
const payouts = hits.map(r => Math.max(r.system1PayoutKr, r.system2PayoutKr));
payouts.sort((a,b) => a-b);
console.log("## 9. Träff-utdelningar (alla träffar, båda systemen)");
console.log(`  Antal: ${payouts.length}`);
if (payouts.length) {
  console.log(`  Min: ${Math.round(Math.min(...payouts))} kr, Max: ${Math.round(Math.max(...payouts))} kr`);
  const median = payouts[Math.floor(payouts.length/2)];
  console.log(`  Median: ${Math.round(median)} kr`);
  console.log(`  Hälften under 100 kr: ${payouts.filter(p=>p<100).length}`);
  console.log(`  Under insats (60 kr): ${payouts.filter(p=>p<60).length}`);
}
console.log();

// 10. Syntetisk förbättring: vad om vi tog 1x6 eller 6x1 istf 2x3/3x2?
// Om vi lade alla 6 hästar på ett ben: täckte vi då vinnaren?
console.log("## 10. Hypotetisk analys: 1×6 system");
let covered1x6Leg1 = 0;
let covered1x6Leg2 = 0;
for (const a of analyses) {
  // Om vi hade leg1 spik och lagt alla 6 hästar på leg2
  // (dvs leg2 täcker top 6 hästar istf top 2-3)
  // Vi vet inte leg2 top6 men vi vet att vinnaren rankades som winnerRankS1Leg2
  // Om vi antar att top6 täcker rank 1-6:
  if (a.winnerRankS1Leg2 <= 6 && a.s1HasLeg1) covered1x6Leg1++;
  if (a.winnerRankS1Leg1 <= 6 && a.s1HasLeg2) covered1x6Leg2++;
}
console.log(`  Om leg1-spik + leg2-top6: ${covered1x6Leg1} träffar (vs nuv. ${s1Hits})`);
console.log(`  Om leg1-top6 + leg2-spik: ${covered1x6Leg2} träffar`);
console.log();

console.log("=== SLUTSATSER ===");
console.log(`1. Vi täcker leg1-vinnaren i ${s1Leg1Covered}% av fallen – OK men inte bra nog`);
console.log(`2. Vi täcker leg2-vinnaren i ${s1Leg2Covered}% av fallen – ${s1Leg2Covered > s1Leg1Covered ? "bättre" : "sämre"}`);
console.log(`3. Kombinations-miss: ${s1BothCovered - s1Hits} gånger hade vi rätt hästar men fel kombo`);
console.log(`4. Äkta skrällar (inget system täckte): ${missesWithNoneCovered} av ${noneHits} missar`);
console.log(`5. ${s1HalfGotLeg1} gånger hade vi leg1 men missade leg2 (utöka leg2-täckning?)`);
console.log(`6. ${s1HalfGotLeg2} gånger hade vi leg2 men missade leg1 (utöka leg1-täckning?)`);
