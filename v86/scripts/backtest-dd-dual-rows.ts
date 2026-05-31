/**
 * Bakåtanalys: system 1 vs system 2 på senaste DD-omgångarna.
 * Kör: npx tsx v86/scripts/backtest-dd-dual-rows.ts [--limit=20]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildSystemHitSummary, extractTravResult } from "../../src/lib/trav-learning.server";
import { fileCacheBackend } from "../src/travsport/file-cache";
import { fetchCalendarDay, fetchGame, listAllowedGamesFromCalendar } from "../src/atg-api";
import { defaultBudgetKr, defaultMinPayoutKr } from "../src/game-types";
import { buildSnapshotFromGame, sanitizeHistoricalGameForPrematch } from "../src/pipeline";
import { formatDdSystemLine, legPickOverlap } from "../src/system-builder";
import type { BuiltSystem } from "../src/types";

const DEFAULT_LIMIT = 20;
const LOOKBACK_DAYS = 400;

type RoundRow = {
  gameDate: string;
  gameId: string;
  track: string;
  winners: string;
  system1Line: string;
  system1Leg1: string;
  system1Leg2: string;
  system1Rows: number;
  system1CostKr: number;
  system1Hit: boolean;
  system1CorrectLegs: number;
  system1PayoutKr: number;
  system1NetKr: number;
  system2Line: string;
  system2Leg1: string;
  system2Leg2: string;
  system2Rows: number;
  system2CostKr: number;
  system2Hit: boolean;
  system2CorrectLegs: number;
  system2PayoutKr: number;
  system2NetKr: number;
  sharedLeg1: number;
  sharedLeg2: number;
  bestRow: "Rad 1" | "Rad 2" | "Ingen";
  bestNetKr: number;
};

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function systemLine(system: BuiltSystem): string {
  return [...system.selections]
    .sort((a, b) => a.leg - b.leg)
    .map((s) => s.picks.join("-"))
    .join(" / ");
}

function picksText(system: BuiltSystem, leg: number): string {
  return system.selections.find((s) => s.leg === leg)?.picks.join(", ") ?? "—";
}

async function collectDdRounds(limit: number) {
  const rounds: { gameId: string; gameDate: string }[] = [];
  const seen = new Set<string>();
  const today = new Date();

  for (let daysBack = 0; daysBack <= LOOKBACK_DAYS && rounds.length < limit; daysBack++) {
    const date = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - daysBack));
    const dateIso = formatDate(date);
    const calendar = await fetchCalendarDay(dateIso).catch(() => null);
    if (!calendar?.games) continue;

    const entries =
      listAllowedGamesFromCalendar(calendar.games).find((item) => item.type === "dd")?.entries ?? [];

    for (const entry of entries) {
      if (rounds.length >= limit) break;
      if (seen.has(entry.id)) continue;
      const game = await fetchGame(entry.id).catch(() => null);
      if (!game || game.status !== "results" || (game.races?.length ?? 0) < 2) continue;
      const gameDate =
        game.races[0]?.date?.slice(0, 10) ??
        game.races[0]?.startTime?.slice(0, 10) ??
        game.races[0]?.scheduledStartTime?.slice(0, 10) ??
        dateIso;
      seen.add(entry.id);
      rounds.push({ gameId: entry.id, gameDate });
    }
  }

  return rounds.sort((a, b) => b.gameDate.localeCompare(a.gameDate));
}

function summarizeSystem(system: BuiltSystem, resolved: ReturnType<typeof extractTravResult>) {
  const hit = buildSystemHitSummary(system, resolved);
  return {
    hit: hit.fullHit,
    correctLegs: hit.correctLegs,
    payoutKr: hit.payoutAmountKr ?? 0,
    netKr: (hit.payoutAmountKr ?? 0) - system.costKr,
  };
}

async function main() {
  const limitArg = process.argv.find((a) => a.startsWith("--limit="));
  const limit = limitArg ? Math.max(1, Number(limitArg.slice(8))) : DEFAULT_LIMIT;

  console.log(`Hämtar ${limit} senaste DD-omgångar med resultat...\n`);
  const rounds = await collectDdRounds(limit);
  if (rounds.length === 0) {
    console.error("Inga avslutade DD-omgångar hittades.");
    process.exit(1);
  }

  const rows: RoundRow[] = [];

  for (const round of rounds) {
    const fullGame = await fetchGame(round.gameId);
    const prematchGame = sanitizeHistoricalGameForPrematch(fullGame);
    const snapshot = await buildSnapshotFromGame(prematchGame, {
      budgetKr: defaultBudgetKr("dd"),
      targetMinPayoutKr: defaultMinPayoutKr("dd"),
      includeAndelsspel: false,
      includeTravsport: true,
      travsportDbCache: fileCacheBackend,
      travsportAllowStaleCache: true,
    });

    const system2 = snapshot.systemAlt ?? snapshot.system;
    const resolved = extractTravResult(fullGame);
    const s1 = summarizeSystem(snapshot.system, resolved);
    const s2 = summarizeSystem(system2, resolved);

    const leg1Primary = snapshot.system.selections.find((s) => s.leg === 1)?.picks ?? [];
    const leg2Primary = snapshot.system.selections.find((s) => s.leg === 2)?.picks ?? [];
    const leg1Alt = system2.selections.find((s) => s.leg === 1)?.picks ?? [];
    const leg2Alt = system2.selections.find((s) => s.leg === 2)?.picks ?? [];

    const winners =
      resolved.legs.length >= 2
        ? `${resolved.legs[0]?.winners[0] ?? "?"}-${resolved.legs[1]?.winners[0] ?? "?"}`
        : "?";

    let bestRow: RoundRow["bestRow"] = "Ingen";
    let bestNetKr = Math.max(s1.netKr, s2.netKr);
    if (s1.netKr > s2.netKr) bestRow = "Rad 1";
    else if (s2.netKr > s1.netKr) bestRow = "Rad 2";
    else if (s1.netKr > 0 && s1.netKr === s2.netKr) bestRow = s1.hit ? "Rad 1" : "Rad 2";

    rows.push({
      gameDate: round.gameDate,
      gameId: round.gameId,
      track: fullGame.races[0]?.track?.name ?? "—",
      winners,
      system1Line: systemLine(snapshot.system),
      system1Leg1: picksText(snapshot.system, 1),
      system1Leg2: picksText(snapshot.system, 2),
      system1Rows: snapshot.system.rows,
      system1CostKr: snapshot.system.costKr,
      system1Hit: s1.hit,
      system1CorrectLegs: s1.correctLegs,
      system1PayoutKr: s1.payoutKr,
      system1NetKr: s1.netKr,
      system2Line: systemLine(system2),
      system2Leg1: picksText(system2, 1),
      system2Leg2: picksText(system2, 2),
      system2Rows: system2.rows,
      system2CostKr: system2.costKr,
      system2Hit: s2.hit,
      system2CorrectLegs: s2.correctLegs,
      system2PayoutKr: s2.payoutKr,
      system2NetKr: s2.netKr,
      sharedLeg1: legPickOverlap(leg1Primary, leg1Alt),
      sharedLeg2: legPickOverlap(leg2Primary, leg2Alt),
      bestRow,
      bestNetKr,
    });

    process.stdout.write(".");
  }
  console.log("\n");

  const total1 = rows.reduce((s, r) => s + r.system1NetKr, 0);
  const total2 = rows.reduce((s, r) => s + r.system2NetKr, 0);
  const wins1 = rows.filter((r) => r.system1Hit).length;
  const wins2 = rows.filter((r) => r.system2Hit).length;
  const oracle = rows.reduce((s, r) => s + Math.max(r.system1NetKr, r.system2NetKr, 0), 0);
  const both = rows.reduce((s, r) => s + r.system1NetKr + r.system2NetKr, 0);

  const hitLabel = (hit: boolean, legs: number) => (hit ? "FULLTRÄFF" : legs === 1 ? "1/2" : "0/2");

  console.log(
    "| Datum | Bana | Resultat | Rad 1 (markering) | Utfall 1 | Netto 1 | Rad 2 (markering) | Utfall 2 | Netto 2 | Bäst |",
  );
  console.log("|-------|------|----------|-------------------|----------|---------|-------------------|----------|---------|------|");
  for (const r of rows) {
    console.log(
      `| ${r.gameDate} | ${r.track} | **${r.winners}** | ${r.system1Line} | ${hitLabel(r.system1Hit, r.system1CorrectLegs)} ${r.system1PayoutKr > 0 ? `(${Math.round(r.system1PayoutKr)} kr)` : ""} | ${r.system1NetKr >= 0 ? "+" : ""}${Math.round(r.system1NetKr)} kr | ${r.system2Line} | ${hitLabel(r.system2Hit, r.system2CorrectLegs)} ${r.system2PayoutKr > 0 ? `(${Math.round(r.system2PayoutKr)} kr)` : ""} | ${r.system2NetKr >= 0 ? "+" : ""}${Math.round(r.system2NetKr)} kr | ${r.bestRow} |`,
    );
  }

  console.log("\n### Summering (20 omgångar)\n");
  console.log(`| Mått | Rad 1 | Rad 2 |`);
  console.log(`|------|-------|-------|`);
  console.log(`| Fullträffar | ${wins1} | ${wins2} |`);
  console.log(`| Spelat totalt | ${rows.reduce((s, r) => s + r.system1CostKr, 0)} kr | ${rows.reduce((s, r) => s + r.system2CostKr, 0)} kr |`);
  console.log(`| **Netto totalt** | **${total1 >= 0 ? "+" : ""}${Math.round(total1)} kr** | **${total2 >= 0 ? "+" : ""}${Math.round(total2)} kr** |`);
  console.log(`| Bästa rad valts varje gång (teoretiskt tak) | — | **+${Math.round(oracle)} kr** |`);
  console.log(`| Båda rader spelade varje gång | — | ${both >= 0 ? "+" : ""}${Math.round(both)} kr |`);

  const winner =
    total1 > total2 ? "Rad 1" : total2 > total1 ? "Rad 2" : "Oavgjort";
  console.log(`\n**Slutsats:** ${winner} hade högst netto över perioden (${Math.round(Math.max(total1, total2))} kr).`);

  const outDir = resolve("v86", "output");
  mkdirSync(outDir, { recursive: true });
  const outPath = resolve(outDir, "dd-dual-rows-backtest.json");
  writeFileSync(
    outPath,
    JSON.stringify({ generatedAt: new Date().toISOString(), limit: rows.length, rows, summary: { total1, total2, wins1, wins2, oracle, both } }, null, 2),
  );
  console.log(`\nSparat: ${outPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
