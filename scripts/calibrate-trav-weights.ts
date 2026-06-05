/**
 * Kalibrerar checklistans vikter via logistisk regression på historisk data.
 * Laddar resolvade trav_predictions, extraherar (checklistpoäng, vann?) per häst/avdelning
 * och kör gradient descent för att hitta vikter som maximerar prediktionsprecision.
 *
 * Kör: npx tsx scripts/calibrate-trav-weights.ts
 * Flaggor:
 *   --min-samples=50   Minsta antal datapunkter per checklistpost för att inkludera den (default 50)
 *   --iterations=2000  Antal gradient-descent-iterationer (default 2000)
 *   --lr=0.05          Inlärningshastighet (default 0.05)
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadEnv, createScriptSupabase } from "../src/lib/script-env";

const args = process.argv.slice(2);
const minSamples = Number(args.find((a) => a.startsWith("--min-samples="))?.split("=")[1] ?? 50);
const iterations = Number(args.find((a) => a.startsWith("--iterations="))?.split("=")[1] ?? 2000);
const lr = Number(args.find((a) => a.startsWith("--lr="))?.split("=")[1] ?? 0.05);

type DataPoint = {
  itemId: string;
  score: number;
  won: number; // 1 = hästen vann avdelningen, 0 = vann ej
};

type ChecklistRow = {
  id: string;
  score: number;
  available: boolean;
};

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-Math.max(-20, Math.min(20, x))));
}

/** Logistisk regression med gradient descent för en enskild feature (checklist-post). */
function fitLogistic(
  data: number[], // scores för denna feature
  labels: number[], // 0/1 utfall
  iters: number,
  learningRate: number,
): { weight: number; bias: number; accuracy: number; auc: number } {
  let w = 0;
  let b = 0;
  const n = data.length;
  if (n === 0) return { weight: 1.0, bias: 0, accuracy: 0, auc: 0.5 };

  for (let iter = 0; iter < iters; iter++) {
    let dw = 0;
    let db = 0;
    for (let i = 0; i < n; i++) {
      const pred = sigmoid(w * data[i] + b);
      const err = pred - labels[i];
      dw += err * data[i];
      db += err;
    }
    w -= (learningRate / n) * dw;
    b -= (learningRate / n) * db;
  }

  const correct = data.filter((x, i) => (sigmoid(w * x + b) >= 0.5 ? 1 : 0) === labels[i]).length;

  // AUC via trapezoidal rule (rang-baserat)
  const pairs = data.map((x, i) => ({ score: sigmoid(w * x + b), label: labels[i] }))
    .sort((a, b) => b.score - a.score);
  let auc = 0;
  let tp = 0;
  let fp = 0;
  const pos = labels.filter((l) => l === 1).length;
  const neg = n - pos;
  for (const p of pairs) {
    if (p.label === 1) tp++;
    else { auc += tp; fp++; }
  }
  auc = pos > 0 && neg > 0 ? auc / (pos * neg) : 0.5;

  return { weight: w, bias: b, accuracy: correct / n, auc };
}

async function main() {
  loadEnv();
  const supabase = createScriptSupabase();

  console.log("Laddar resolvade trav_predictions...");
  const { data: rows, error } = await supabase
    .from("trav_predictions")
    .select("id, game_type, legs_json, system_json, winning_numbers_json, system_hit_summary, meta_json")
    .not("resolved_at", "is", null)
    .not("winning_numbers_json", "is", null)
    .limit(2000);

  if (error) throw new Error(`Supabase-fel: ${error.message}`);
  if (!rows?.length) {
    console.log("Inga resolvade rader hittades. Kör backfill-2026-rounds.ts först.");
    return;
  }

  console.log(`Hittade ${rows.length} resolvade omgångar.`);

  // Samla (checklistpost → score, vann?) per häst
  const byItem = new Map<string, DataPoint[]>();

  let parsedLegs = 0;
  let skippedLegs = 0;

  for (const row of rows) {
    const legs = row.legs_json as any[] | null;
    const winners = row.winning_numbers_json as Array<{ leg: number; winners: number[] }> | null;
    if (!legs?.length || !winners?.length) continue;

    const winnersByLeg = new Map<number, Set<number>>();
    for (const w of winners) {
      winnersByLeg.set(w.leg, new Set(w.winners));
    }

    for (const leg of legs) {
      const legIdx: number = leg.leg;
      const legWinners = winnersByLeg.get(legIdx);
      if (!legWinners || legWinners.size === 0) { skippedLegs++; continue; }

      for (const horse of leg.horses ?? []) {
        const won = legWinners.has(horse.number) ? 1 : 0;
        const checklist: ChecklistRow[] = [...(horse.horseChecklist ?? []), ...(horse.driverChecklist ?? [])];

        for (const item of checklist) {
          if (!item.available) continue;
          const pts = byItem.get(item.id) ?? [];
          pts.push({ itemId: item.id, score: item.score, won });
          byItem.set(item.id, pts);
        }
        parsedLegs++;
      }
    }
  }

  console.log(`\nParsade ${parsedLegs} häst-starter, ${skippedLegs} avdelningar saknade vinnardata.\n`);

  // Kör logistisk regression per checklistpost
  const results: Array<{
    itemId: string;
    n: number;
    winRate: number;
    weight: number;
    bias: number;
    accuracy: number;
    auc: number;
    suggestedWeight: number;
    currentWeight: string;
  }> = [];

  const CURRENT_WEIGHTS: Record<string, number> = {
    recent_starts: 1.3,
    form_curve: 1.0,
    distance: 1.1,
    lane_start: 0.9,
    track: 0.9,
    surface: 0.5,
    class: 0.9,
    trainer: 1.0,
    equipment: 0.7,
    pedigree: 0.65,
    speed: 1.0,
    rest: 0.7,
    gallop_risk: 1.0,
    tempo_trip: 0.85,
    driver_form: 1.2,
    driver_trend: 0.8,
    horse_pair: 1.0,
    big_pool: 0.7,
    driver_track: 0.7,
    driving_style: 0.4,
    favorite_delivery: 1.1,
    trainer_pair: 0.8,
  };

  for (const [itemId, points] of byItem.entries()) {
    if (points.length < minSamples) continue;

    const scores = points.map((p) => p.score);
    const labels = points.map((p) => p.won);
    const winRate = labels.filter((l) => l === 1).length / labels.length;

    const result = fitLogistic(scores, labels, iterations, lr);

    // Konvertera logistisk vikt till en relativ vikt (skalar 0.3–2.0)
    const absW = Math.abs(result.weight);
    const suggestedWeight = Math.round(Math.min(2.0, Math.max(0.3, absW * 2.5)) * 100) / 100;

    results.push({
      itemId,
      n: points.length,
      winRate: Math.round(winRate * 1000) / 10,
      weight: Math.round(result.weight * 1000) / 1000,
      bias: Math.round(result.bias * 1000) / 1000,
      accuracy: Math.round(result.accuracy * 1000) / 10,
      auc: Math.round(result.auc * 1000) / 1000,
      suggestedWeight,
      currentWeight: String(CURRENT_WEIGHTS[itemId] ?? "?"),
    });
  }

  results.sort((a, b) => b.auc - a.auc);

  console.log("=== KALIBRERADE VIKTER (sorterat på AUC) ===\n");
  console.log(
    `${"Post".padEnd(22)} ${"N".padStart(6)} ${"AUC".padStart(6)} ${"Acc%".padStart(6)} ${"Nuv".padStart(6)} ${"Förslag".padStart(8)} ${"Förändring"}`
  );
  console.log("─".repeat(72));

  for (const r of results) {
    const delta = r.suggestedWeight - Number(r.currentWeight);
    const arrow = delta > 0.05 ? "↑" : delta < -0.05 ? "↓" : "≈";
    console.log(
      `${r.itemId.padEnd(22)} ${String(r.n).padStart(6)} ${r.auc.toFixed(3).padStart(6)} ${String(r.accuracy).padStart(6)} ${r.currentWeight.padStart(6)} ${String(r.suggestedWeight).padStart(8)} ${arrow} ${delta > 0.05 || delta < -0.05 ? `(${delta > 0 ? "+" : ""}${delta.toFixed(2)})` : ""}`
    );
  }

  const outPath = resolve("v86", "output", "calibrated-weights.json");
  writeFileSync(
    outPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        totalRows: rows.length,
        totalDataPoints: parsedLegs,
        minSamples,
        iterations,
        results,
      },
      null,
      2,
    ),
    "utf-8",
  );

  console.log(`\nSparade resultat: ${outPath}`);
  console.log("\nSå här tillämpar du vikterna manuellt i horse-checklist.ts och driver-checklist.ts:");
  for (const r of results) {
    if (Math.abs(r.suggestedWeight - Number(r.currentWeight)) > 0.1) {
      console.log(`  "${r.itemId}": ${r.currentWeight} → ${r.suggestedWeight} (AUC ${r.auc.toFixed(3)})`);
    }
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
