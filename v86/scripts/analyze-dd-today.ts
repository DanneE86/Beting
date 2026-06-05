import { hybridTravsportCache } from "../../src/lib/travsport-cache-backend";
import { buildSnapshot, todayIso } from "../src/pipeline";
import { formatDdSystemLine } from "../src/system-builder";
import type { BuiltSystem } from "../src/types";
import { resolvePrimaryDd } from "../src/v85-schedule";
import { defaultBudgetKr } from "../src/game-types";
import { printReport } from "../src/run";

function printDdLine(label: string, system: BuiltSystem) {
  const marks = [...system.selections]
    .sort((a, b) => a.leg - b.leg)
    .map((s) => s.picks.join("/"))
    .join(" x ");
  console.log(`\n>>> ${label}: ${marks} (${system.rows} rader, ${system.costKr} kr) <<<`);
  console.log(`    ${formatDdSystemLine(system)}`);
}

async function main() {
  const date = process.argv.find((a) => a.startsWith("--date="))?.slice(7) ?? todayIso();
  const dd = await resolvePrimaryDd(date);
  if (!dd) {
    console.error(`Ingen Dagens Dubbel hittades från ${date}.`);
    process.exit(1);
  }

  const snapshot = await buildSnapshot({
    date,
    gameId: dd.gameId,
    budgetKr: defaultBudgetKr("dd"),
    travsportDbCache: hybridTravsportCache,
  });

  printDdLine("DD-RAD 1", snapshot.system);
  if (snapshot.systemAlt) {
    printDdLine("DD-RAD 2", snapshot.systemAlt);
  }
  printReport(snapshot);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
