import { backfillTravPredictionRaceData } from "../../src/lib/trav-learning.server";
import type { PoolGameType } from "../src/types";

function parseArgs(argv: string[]) {
  const out: { limit?: number; gameType?: PoolGameType } = {};
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--limit" && argv[index + 1]) {
      out.limit = Number(argv[++index]);
    } else if (arg === "--gameType" && argv[index + 1]) {
      const value = argv[++index];
      if (value === "V85" || value === "V86" || value === "dd") {
        out.gameType = value;
      }
    }
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const result = await backfillTravPredictionRaceData(args.limit ?? 100, args.gameType ?? null);
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
