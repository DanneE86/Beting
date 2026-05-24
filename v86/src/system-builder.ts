import { rowPriceKr } from "./game-types";
import type {
  BuiltSystem,
  LegAnalysis,
  PoolGameType,
  SystemSelection,
} from "./types";

export interface BuildOptions {
  budgetKr: number;
  targetMinPayoutKr: number;
  forceSkrellLeg?: number | null;
}

function legPickCount(leg: LegAnalysis, mode: "spik" | "skrell-spik" | "gardering" | "bred"): number {
  const n = leg.horses.length;
  switch (mode) {
    case "spik":
    case "skrell-spik":
      return 1;
    case "gardering":
      return Math.min(n, leg.recommendation === "bred" ? 4 : 3);
    case "bred":
      return Math.min(n, 5);
    default:
      return 2;
  }
}

function picksForLeg(
  leg: LegAnalysis,
  mode: "spik" | "skrell-spik" | "gardering" | "bred",
  skrellNumber?: number,
): number[] {
  if (mode === "skrell-spik" && skrellNumber != null) return [skrellNumber];
  if (mode === "spik") {
    const top = [...leg.horses].sort(
      (a, b) => (b.combinedScore ?? 0) - (a.combinedScore ?? 0),
    )[0];
    return [top?.number ?? leg.favorite.number];
  }

  const count = legPickCount(leg, mode);
  const byForm = [...leg.horses].sort(
    (a, b) => (b.combinedScore ?? b.formScore) - (a.combinedScore ?? a.formScore),
  );
  const byMarket = [...leg.horses].sort((a, b) => b.betDistribution - a.betDistribution);
  const chosen = new Set<number>();
  for (const h of byMarket.slice(0, Math.ceil(count / 2))) chosen.add(h.number);
  for (const h of byForm.slice(0, count)) chosen.add(h.number);
  return [...chosen].slice(0, count);
}

function product(nums: number[]): number {
  return nums.reduce((a, b) => a * b, 1);
}

/** Bygger garderingar inom budget; prioriterar spikar på starka favoriter. */
export function buildSystem(
  gameId: string,
  gameType: PoolGameType,
  legs: LegAnalysis[],
  options: BuildOptions,
): BuiltSystem {
  const unitKr = rowPriceKr(gameType);
  const maxRows = Math.floor(options.budgetKr / unitKr);
  const skrellLeg = options.forceSkrellLeg ?? null;
  const skrellLegAnalysis =
    skrellLeg != null
      ? legs.find((l) => l.leg === skrellLeg)
      : legs.find((l) => l.skrellSpike && l.recommendation !== "spik");

  const selections: SystemSelection[] = [];
  const counts: number[] = [];

  for (const leg of legs) {
    let mode: SystemSelection["type"] = "gardering";
    let note: string | undefined;

    if (skrellLegAnalysis?.leg === leg.leg && leg.skrellSpike) {
      mode = "skrell-spik";
      note = `Skräll-spik: ${leg.skrellSpike.name} (${leg.skrellSpike.betDistribution.toFixed(1)}% av spelet)`;
    } else if (leg.recommendation === "spik") {
      mode = "spik";
      note = `Favorit-spik: ${leg.favorite.name} (${leg.favorite.betDistribution.toFixed(1)}%)`;
    } else if (leg.recommendation === "bred") {
      mode = "gardering";
      note = "Öppet lopp – bred gardering";
    }

    const picks = picksForLeg(
      leg,
      mode === "skrell-spik" ? "skrell-spik" : mode === "spik" ? "spik" : "gardering",
      leg.skrellSpike?.number,
    );
    counts.push(picks.length);
    selections.push({ leg: leg.leg, picks, type: mode, note });
  }

  let rows = product(counts);
  let costKr = rows * unitKr;

  // Utöka garderingar om under budget (max 5 hästar per öppet lopp)
  while (costKr < options.budgetKr * 0.92) {
    let expanded = false;
    for (let i = 0; i < legs.length; i++) {
      if (selections[i].type !== "gardering") continue;
      const leg = legs[i];
      const maxH = Math.min(leg.horses.length, 5);
      if (selections[i].picks.length >= maxH) continue;
      selections[i].picks = picksForLeg(leg, "bred").slice(0, selections[i].picks.length + 1);
      counts[i] = selections[i].picks.length;
      expanded = true;
      break;
    }
    if (!expanded) break;
    rows = product(counts);
    costKr = rows * unitKr;
    if (costKr > options.budgetKr) break;
  }

  // Trimma garderingar om över budget (behåll spikar)
  while (costKr > options.budgetKr && rows > 1) {
    let trimmed = false;
    for (let i = 0; i < legs.length; i++) {
      if (selections[i].type !== "gardering") continue;
      if (selections[i].picks.length <= 2) continue;
      const leg = legs[i];
      const nextCount = selections[i].picks.length - 1;
      selections[i].picks = picksForLeg(leg, "gardering").slice(0, nextCount);
      counts[i] = selections[i].picks.length;
      trimmed = true;
      break;
    }
    if (!trimmed) break;
    rows = product(counts);
    costKr = rows * unitKr;
  }

  const gameLabel = gameType === "dd" ? "Dagens Dubbel" : "V85";
  const estimatedPayoutNote =
    `Mål: utdelning ≥ ${options.targetMinPayoutKr.toLocaleString("sv-SE")} kr vid fullträff (${gameLabel}). ` +
    `ATG garanterar inte min utdelning – se atg.se. ` +
    `System: ${rows} rader × ${unitKr} kr = ${costKr.toFixed(2)} kr.`;

  return {
    gameId,
    gameType,
    budgetKr: options.budgetKr,
    rows,
    costKr,
    targetMinPayoutKr: options.targetMinPayoutKr,
    estimatedPayoutNote,
    selections,
    skrellSpikeLeg: skrellLegAnalysis?.leg ?? null,
  };
}
