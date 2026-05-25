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

function topModelHorse(leg: LegAnalysis) {
  return (
    [...leg.horses].sort((a, b) => (b.combinedScore ?? 0) - (a.combinedScore ?? 0))[0] ??
    leg.favorite
  );
}

function secondModelHorse(leg: LegAnalysis) {
  return [...leg.horses].sort((a, b) => (b.combinedScore ?? 0) - (a.combinedScore ?? 0))[1] ?? null;
}

function scoreModelSpikeLeg(leg: LegAnalysis): number {
  const top = topModelHorse(leg);
  const second = secondModelHorse(leg);
  const gap = Math.max(0, (top?.combinedScore ?? 0) - (second?.combinedScore ?? 0));
  let score = (top?.combinedScore ?? 0) * 100 + gap * 120 + (top?.betDistribution ?? 0) * 0.5;
  if (leg.recommendation === "spik") score += 60;
  if (top?.number === leg.favorite.number) score += 12;
  return score;
}

function scoreValueSpikeHorse(leg: LegAnalysis, horse: LegAnalysis["horses"][number]): number {
  const bd = horse.betDistribution ?? 0;
  const moderateBdBonus = bd >= 4 && bd <= 20 ? 12 : bd <= 30 ? 6 : 0;
  const nonFavBonus = horse.number !== leg.favorite.number ? 10 : 0;
  const openRacePenalty = leg.recommendation === "bred" ? 12 : 0;
  return (
    (horse.valueEdgePct ?? 0) * 2.4 +
    (horse.valueScore ?? 0) * 14 +
    (horse.combinedScore ?? 0) * 70 +
    moderateBdBonus +
    nonFavBonus -
    openRacePenalty
  );
}

function pickValueSpikeHorse(leg: LegAnalysis) {
  const hasMarketData = leg.horses.some((horse) => horse.betDistribution > 0);

  if (!hasMarketData) {
    const modelTop = topModelHorse(leg);
    const second = secondModelHorse(leg);
    if ((modelTop?.combinedScore ?? 0) >= 0.58) return modelTop;
    return second ?? modelTop;
  }

  const candidates = leg.horses.filter(
    (horse) =>
      horse.betDistribution >= 2 &&
      horse.betDistribution <= 30 &&
      horse.combinedScore >= 0.46 &&
      horse.number !== leg.favorite.number,
  );
  if (candidates.length) {
    return [...candidates].sort((a, b) => scoreValueSpikeHorse(leg, b) - scoreValueSpikeHorse(leg, a))[0];
  }

  const softerCandidates = leg.horses.filter(
    (horse) =>
      horse.betDistribution >= 4 &&
      horse.betDistribution <= 35 &&
      horse.combinedScore >= 0.5,
  );
  if (softerCandidates.length) {
    return [...softerCandidates].sort((a, b) => scoreValueSpikeHorse(leg, b) - scoreValueSpikeHorse(leg, a))[0];
  }

  return leg.skrellSpike ?? null;
}

function chooseForcedV85Spikes(
  legs: LegAnalysis[],
  forceSkrellLeg?: number | null,
): {
  spikeByLeg: Map<number, { type: "spik" | "skrell-spik"; number: number }>;
} {
  const spikeByLeg = new Map<number, { type: "spik" | "skrell-spik"; number: number }>();

  const valueCandidates = legs
    .map((leg) => ({ leg, horse: pickValueSpikeHorse(leg) }))
    .filter((entry): entry is { leg: LegAnalysis; horse: NonNullable<ReturnType<typeof pickValueSpikeHorse>> } => Boolean(entry.horse))
    .sort((a, b) => {
      const aScore = scoreValueSpikeHorse(a.leg, a.horse);
      const bScore = scoreValueSpikeHorse(b.leg, b.horse);
      const aPreferred = a.horse.betDistribution >= 4 && a.horse.betDistribution <= 20 ? 1 : 0;
      const bPreferred = b.horse.betDistribution >= 4 && b.horse.betDistribution <= 20 ? 1 : 0;
      return bPreferred - aPreferred || bScore - aScore;
    });

  const modelCandidates = [...legs].sort((a, b) => scoreModelSpikeLeg(b) - scoreModelSpikeLeg(a));

  let firstValueChoice =
    forceSkrellLeg != null
      ? valueCandidates.find((entry) => entry.leg.leg === forceSkrellLeg) ?? null
      : null;
  if (!firstValueChoice) firstValueChoice = valueCandidates[0] ?? null;

  if (firstValueChoice) {
    spikeByLeg.set(firstValueChoice.leg.leg, {
      type: "skrell-spik",
      number: firstValueChoice.horse.number,
    });
  }

  const remainingModel = modelCandidates.filter((leg) => !spikeByLeg.has(leg.leg));
  const remainingValue = valueCandidates.filter((entry) => !spikeByLeg.has(entry.leg.leg));

  const secondValueChoice = remainingValue[0] ?? null;
  const secondModelChoice = remainingModel[0] ?? null;

  if (!firstValueChoice && !secondModelChoice && legs[0]) {
    spikeByLeg.set(legs[0].leg, { type: "spik", number: topModelHorse(legs[0]).number });
    return { spikeByLeg };
  }

  if (secondValueChoice && secondModelChoice) {
    const valueScore = scoreValueSpikeHorse(secondValueChoice.leg, secondValueChoice.horse);
    const modelScore = scoreModelSpikeLeg(secondModelChoice);
    const strongLowPctValue =
      secondValueChoice.horse.betDistribution > 0 &&
      secondValueChoice.horse.betDistribution <= 15 &&
      secondValueChoice.horse.combinedScore >= 0.64;
    if (valueScore >= modelScore + 4 || (strongLowPctValue && valueScore >= modelScore - 8)) {
      spikeByLeg.set(secondValueChoice.leg.leg, {
        type: "skrell-spik",
        number: secondValueChoice.horse.number,
      });
    } else {
      spikeByLeg.set(secondModelChoice.leg, {
        type: "spik",
        number: topModelHorse(secondModelChoice).number,
      });
    }
    return { spikeByLeg };
  }

  if (secondValueChoice) {
    spikeByLeg.set(secondValueChoice.leg.leg, {
      type: "skrell-spik",
      number: secondValueChoice.horse.number,
    });
  } else if (secondModelChoice) {
    spikeByLeg.set(secondModelChoice.leg, {
      type: "spik",
      number: topModelHorse(secondModelChoice).number,
    });
  }

  return { spikeByLeg };
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
  fixedNumber?: number,
): number[] {
  if ((mode === "skrell-spik" || mode === "spik") && fixedNumber != null) return [fixedNumber];
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
  const isMainPool = gameType !== "dd";
  const unitKr = rowPriceKr(gameType);
  const maxRows = Math.floor(options.budgetKr / unitKr);
  const forcedV85Spikes =
    isMainPool ? chooseForcedV85Spikes(legs, options.forceSkrellLeg ?? null) : null;
  const skrellLegAnalysis =
    isMainPool
      ? legs.find((leg) => forcedV85Spikes?.spikeByLeg.get(leg.leg)?.type === "skrell-spik") ?? null
      : options.forceSkrellLeg != null
        ? legs.find((l) => l.leg === options.forceSkrellLeg) ?? null
        : legs.find((l) => l.skrellSpike && l.recommendation !== "spik") ?? null;

  const selections: SystemSelection[] = [];
  const counts: number[] = [];

  for (const leg of legs) {
    let mode: SystemSelection["type"] = "gardering";
    let note: string | undefined;
    let fixedNumber: number | undefined;
    const forcedSpike = forcedV85Spikes?.spikeByLeg.get(leg.leg);

    if (forcedSpike?.type === "skrell-spik" || (!isMainPool && skrellLegAnalysis?.leg === leg.leg)) {
      mode = "skrell-spik";
      fixedNumber =
        forcedSpike?.number ?? leg.skrellSpike?.number ?? leg.favorite.number;
      const skrellHorse = leg.horses.find((horse) => horse.number === fixedNumber) ?? leg.skrellSpike ?? leg.favorite;
      note =
        skrellHorse.betDistribution > 0
          ? `Skräll-spik: ${skrellHorse.name} (${skrellHorse.betDistribution.toFixed(1)}% av spelet)`
          : `Värdespik: ${skrellHorse.name} (spelprocent saknas ännu)`;
    } else if (forcedSpike?.type === "spik" || (!isMainPool && leg.recommendation === "spik")) {
      mode = "spik";
      const favoriteHorse = topModelHorse(leg);
      fixedNumber = forcedSpike?.number ?? favoriteHorse.number;
      const spikeHorse = leg.horses.find((horse) => horse.number === fixedNumber) ?? favoriteHorse;
      note =
        spikeHorse.betDistribution > 0
          ? `Modellspik: ${spikeHorse.name} (${spikeHorse.betDistribution.toFixed(1)}%)`
          : `Modellspik: ${spikeHorse.name} (spelprocent saknas ännu)`;
    } else if (leg.recommendation === "bred") {
      mode = "gardering";
      note = "Öppet lopp – bred gardering";
    }

    const picks = picksForLeg(
      leg,
      mode === "skrell-spik" ? "skrell-spik" : mode === "spik" ? "spik" : "gardering",
      fixedNumber,
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

  const gameLabel = gameType === "dd" ? "Dagens Dubbel" : gameType;
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
