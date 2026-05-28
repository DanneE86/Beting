import { mkdir, writeFile } from "fs/promises";
import { resolve } from "path";
import { hybridTravsportCache } from "../../src/lib/travsport-cache-backend";
import { saveTravPrediction } from "../../src/lib/trav-learning.server";
import type { FetchSnapshot } from "./types";
import { buildSnapshot, todayIso } from "./pipeline";
import { defaultBudgetKr } from "./game-types";
import { pickBestSkrellLeg } from "./analyze";

function parseArgs(argv: string[]) {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--date" && argv[i + 1]) out.date = argv[++i];
    if (argv[i] === "--game" && argv[i + 1]) out.game = argv[++i];
    if (argv[i] === "--budget" && argv[i + 1]) out.budget = argv[++i];
    if (argv[i] === "--min-payout" && argv[i + 1]) out.minPayout = argv[++i];
  }
  return out;
}

function printReport(snapshot: FetchSnapshot) {
  const { game, legs, system } = snapshot;
  console.log(`\n=== ${game.type} ${game.id} ===`);
  console.log(`Status: ${game.status}`);
  const pool = game.pools?.[game.type];
  if (pool?.turnover) {
    console.log(
      `Omsättning: ${(pool.turnover / 100).toLocaleString("sv-SE")} kr | System: ${pool.systemCount ?? "?"}`,
    );
  }

  for (const leg of legs) {
    console.log(`\n--- Avdelning ${leg.leg} (${leg.track}${leg.raceName ? ` – ${leg.raceName}` : ""}) ---`);
    console.log(`Rekommendation: ${leg.recommendation.toUpperCase()}`);
    const top = leg.horses.slice(0, 4);
    for (const h of top) {
      console.log(
        `  ${h.number}. ${h.name} | ${h.betDistribution.toFixed(1)}% | odds ${h.winOdds?.toFixed(2) ?? "-"} | form ${h.formScore.toFixed(2)}`,
      );
    }
    if (leg.skrellSpike) {
      console.log(
        `  Skräll: ${leg.skrellSpike.number}. ${leg.skrellSpike.name} (värde ${leg.skrellSpike.valueScore.toFixed(2)}, ${leg.skrellSpike.betDistribution.toFixed(1)}%)`,
      );
    }
  }

  const bestSkrell = pickBestSkrellLeg(legs);
  if (bestSkrell?.skrellSpike) {
    console.log(
      `\n★ Bästa skräll-spik: avd ${bestSkrell.leg} – ${bestSkrell.skrellSpike.number}. ${bestSkrell.skrellSpike.name}`,
    );
  }

  console.log(`\n=== System ${system.costKr.toFixed(0)} kr / ${system.rows} rader ===`);
  for (const s of system.selections) {
    console.log(`Avd ${s.leg} [${s.type}]: ${s.picks.join(", ")}${s.note ? ` — ${s.note}` : ""}`);
  }
  console.log(`\n${system.estimatedPayoutNote}`);

  if (snapshot.andelsspel?.length) {
    console.log("\n=== Andelsspel – topprankade andelar ===");
    for (const a of snapshot.andelsspel.slice(0, 8)) {
      console.log(
        `- ${a.name} | ${a.costKr ?? "?"} kr/andel${a.sharesLeft != null ? ` | ${a.sharesLeft} kvar` : ""} | ${a.expert ?? ""}`,
      );
    }
    console.log(
      `Totalt ~1460 andelar – se ${snapshot.andelsspel[0]?.url ?? "https://www.atg.se/andelsspel"}`,
    );
  }
}

export async function runV86Pipeline(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const inferredGameType = args.game?.startsWith("dd_")
    ? "dd"
    : args.game?.startsWith("V85_")
      ? "V85"
      : "V86";
  const snapshot = await buildSnapshot({
    date: args.date ?? todayIso(),
    gameId: args.game ?? argv.find((a) => a.startsWith("V86_") || a.startsWith("V85_") || a.startsWith("dd_")),
    budgetKr: Number(args.budget ?? defaultBudgetKr(inferredGameType)),
    targetMinPayoutKr: Number(args.minPayout ?? 30_000),
    travsportDbCache: hybridTravsportCache,
  });

  const outDir = resolve("v86", "output");
  await mkdir(outDir, { recursive: true });
  const outFile = resolve(outDir, `${snapshot.game.id.replace(/[/\\?%*:|"<>]/g, "_")}.json`);
  await writeFile(outFile, JSON.stringify(snapshot, null, 2), "utf-8");
  console.log(`Sparat: ${outFile}`);

  try {
    const { id: predictionId, error } = await saveTravPrediction(snapshot);
    if (predictionId) console.log(`Historikrad sparad: ${predictionId}`);
    else if (error) console.warn(`Historik: ${error}`);
  } catch (error) {
    console.warn("Kunde inte spara travhistorik från CLI:", (error as Error).message);
  }

  printReport(snapshot);
  return snapshot;
}

