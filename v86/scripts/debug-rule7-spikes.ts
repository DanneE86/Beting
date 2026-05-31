/**
 * Debug: varför har rule7 fortfarande 3 spikar i runda 1?
 */
import { fetchGame } from "../src/atg-api";
import { buildSnapshotFromGame, sanitizeHistoricalGameForPrematch } from "../src/pipeline";
import { fileCacheBackend } from "../src/travsport/file-cache";

const GAME_ID = "V85_2026-01-17_14_3";

async function main() {
  const fullGame = await fetchGame(GAME_ID);
  const prematch = sanitizeHistoricalGameForPrematch(fullGame);

  for (const ruleId of ["rule6", "rule7"] as const) {
    const snapshot = await buildSnapshotFromGame(prematch, {
      ruleId,
      includeAndelsspel: false,
      includeTravsport: true,
      travsportDbCache: fileCacheBackend,
      travsportAllowStaleCache: true,
    });

    const spikeCount = snapshot.system.selections.filter(s => s.type !== "gardering").length;
    console.log(`\n=== ${ruleId.toUpperCase()} ===`);
    console.log(`  Rader: ${snapshot.system.rows}, Kostnad: ${snapshot.system.costKr} kr`);
    console.log(`  Spikar: ${spikeCount}`);
    for (const sel of snapshot.system.selections) {
      console.log(`  Leg ${sel.leg}: [${sel.picks.join(",")}] typ=${sel.type}`);
    }
    console.log(`  Legs conservativeGardering: ${snapshot.legs.map(l => l.conservativeGardering).join(",")}`);
    console.log(`  Legs bankabilityScore: ${snapshot.legs.map(l => l.bankabilityScore).join(",")}`);
    console.log(`  Legs recommendation: ${snapshot.legs.map(l => l.recommendation).join(",")}`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
