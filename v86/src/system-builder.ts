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

function modelRankOfHorse(leg: LegAnalysis, horseNumber: number): number {
  const index = [...leg.horses]
    .sort((a, b) => (b.combinedScore ?? 0) - (a.combinedScore ?? 0))
    .findIndex((horse) => horse.number === horseNumber);
  return index >= 0 ? index + 1 : 999;
}

function valueEdgeSignal(horse: LegAnalysis["horses"][number]): number {
  if (horse.valueEdgePct != null) return horse.valueEdgePct;
  if (horse.valueScore != null && horse.valueScore > 0) {
    return (horse.valueScore - 1) * 10;
  }
  return 0;
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
  const edge = valueEdgeSignal(horse);
  const rank = modelRankOfHorse(leg, horse.number);
  const modelTop = topModelHorse(leg);
  const gapToTop = Math.max(0, (modelTop?.combinedScore ?? 0) - (horse.combinedScore ?? 0));
  const rankBonus = rank === 1 ? 8 : rank === 2 ? 3 : -10;
  const bdPenalty = Math.abs(bd - 14) * 0.6;
  const longshotPenalty = bd > 0 && bd < 6 ? 20 : 0;
  const favoritePenalty = horse.number === leg.favorite.number ? 100 : 0;
  return (
    (horse.combinedScore ?? 0) * 100 +
    edge * 2.5 +
    (horse.estimatedWinPct ?? 0) -
    gapToTop * 100 +
    rankBonus -
    bdPenalty -
    longshotPenalty -
    favoritePenalty
  );
}

function pickValueSpikeHorse(leg: LegAnalysis) {
  const hasMarketData = leg.horses.some((horse) => horse.betDistribution > 0);

  if (!hasMarketData) {
    const modelTop = topModelHorse(leg);
    const second = secondModelHorse(leg);
    if (modelTop && modelTop.number !== leg.favorite.number && (modelTop.combinedScore ?? 0) >= 0.62) {
      return modelTop;
    }
    if (second && (second.combinedScore ?? 0) >= 0.6) return second;
    return null;
  }

  const candidates = leg.horses.filter(
    (horse) =>
      horse.number !== leg.favorite.number &&
      horse.betDistribution >= 6 &&
      horse.betDistribution <= 32 &&
      horse.combinedScore >= 0.52 &&
      valueEdgeSignal(horse) >= 1 &&
      modelRankOfHorse(leg, horse.number) <= 2 &&
      Math.max(0, (topModelHorse(leg)?.combinedScore ?? 0) - (horse.combinedScore ?? 0)) <= 0.12,
  );
  if (candidates.length) {
    return [...candidates].sort((a, b) => scoreValueSpikeHorse(leg, b) - scoreValueSpikeHorse(leg, a))[0];
  }

  const softerCandidates = leg.horses.filter(
    (horse) =>
      horse.number !== leg.favorite.number &&
      horse.betDistribution >= 6 &&
      horse.betDistribution <= 20 &&
      horse.combinedScore >= 0.56 &&
      valueEdgeSignal(horse) >= 1 &&
      modelRankOfHorse(leg, horse.number) <= 2,
  );
  if (softerCandidates.length) {
    return [...softerCandidates].sort((a, b) => scoreValueSpikeHorse(leg, b) - scoreValueSpikeHorse(leg, a))[0];
  }

  return null;
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
  const secondModelChoice = remainingModel[0] ?? null;

  if (!firstValueChoice && !secondModelChoice && legs[0]) {
    spikeByLeg.set(legs[0].leg, { type: "spik", number: topModelHorse(legs[0]).number });
    return { spikeByLeg };
  }

  if (secondModelChoice) {
    spikeByLeg.set(secondModelChoice.leg, {
      type: "spik",
      number: topModelHorse(secondModelChoice).number,
    });
  }

  return { spikeByLeg };
}

function baseGuardCount(leg: LegAnalysis): number {
  const n = leg.horses.length;
  if (leg.recommendation === "bred") return Math.min(n, 4);
  if (leg.skrellSpike && n >= 4) return Math.min(n, 4);
  return Math.min(n, 3);
}

function maxGuardCount(leg: LegAnalysis): number {
  const n = leg.horses.length;
  if (leg.recommendation === "bred" && leg.skrellSpike) return Math.min(n, 6);
  if (leg.recommendation === "bred" || leg.skrellSpike) return Math.min(n, 5);
  return Math.min(n, 4);
}

function legPickCount(leg: LegAnalysis, mode: "spik" | "skrell-spik" | "gardering" | "bred"): number {
  switch (mode) {
    case "spik":
    case "skrell-spik":
      return 1;
    case "gardering":
      return baseGuardCount(leg);
    case "bred":
      return maxGuardCount(leg);
    default:
      return 2;
  }
}

function coverageOrder(leg: LegAnalysis): number[] {
  const byForm = [...leg.horses].sort(
    (a, b) => (b.combinedScore ?? b.formScore) - (a.combinedScore ?? a.formScore),
  );
  const byMarket = [...leg.horses].sort((a, b) => b.betDistribution - a.betDistribution);
  const ordered: number[] = [];
  const addHorse = (horse?: LegAnalysis["horses"][number] | null) => {
    if (!horse) return;
    if (!ordered.includes(horse.number)) ordered.push(horse.number);
  };

  addHorse(topModelHorse(leg));
  addHorse(leg.skrellSpike);
  addHorse(leg.favorite);
  addHorse(secondModelHorse(leg));
  for (const horse of byMarket) addHorse(horse);
  for (const horse of byForm) addHorse(horse);
  return ordered;
}

function horseCoverageScore(leg: LegAnalysis, horse: LegAnalysis["horses"][number]): number {
  const rank = modelRankOfHorse(leg, horse.number);
  const modelTop = topModelHorse(leg);
  const gapToTop = Math.max(0, (modelTop?.combinedScore ?? 0) - (horse.combinedScore ?? 0));
  let score =
    (horse.combinedScore ?? 0) * 100 +
    (horse.estimatedWinPct ?? (horse.combinedScore ?? 0) * 100) * 0.7 +
    valueEdgeSignal(horse) * 2.2 -
    gapToTop * 100;
  if (rank === 1) score += 8;
  else if (rank === 2) score += 4;
  else if (rank >= 5) score -= 4;
  if (horse.betDistribution >= 4 && horse.betDistribution <= 20) score += 4;
  if (leg.skrellSpike?.number === horse.number) score += 5;
  if (leg.recommendation === "bred") score += 8;
  if (horse.formTrend === "nedåtgående") score -= 12;
  return score;
}

function nextCoverageHorse(
  leg: LegAnalysis,
  selectedNumbers: number[],
): LegAnalysis["horses"][number] | null {
  const nextNumber = coverageOrder(leg).find((number) => !selectedNumbers.includes(number));
  return leg.horses.find((horse) => horse.number === nextNumber) ?? null;
}

function removableCoverageHorse(
  leg: LegAnalysis,
  selectedNumbers: number[],
): LegAnalysis["horses"][number] | null {
  const ordered = coverageOrder(leg);
  const removableNumber = [...selectedNumbers]
    .sort((a, b) => ordered.indexOf(b) - ordered.indexOf(a))[0];
  return leg.horses.find((horse) => horse.number === removableNumber) ?? null;
}

function garderingPriority(leg: LegAnalysis): number {
  const favoriteBd = leg.favorite.betDistribution ?? 0;
  const top = topModelHorse(leg);
  const second = secondModelHorse(leg);
  const modelGap = Math.max(0, (top?.combinedScore ?? 0) - (second?.combinedScore ?? 0));
  let score = leg.recommendation === "bred" ? 30 : 0;
  if (leg.skrellSpike) score += 24;
  if (favoriteBd > 0) score += Math.max(0, 28 - favoriteBd);
  score += Math.min(leg.horses.length, 12);
  score += Math.max(0, 0.12 - modelGap) * 120;
  return score;
}

function projectedRowsForShift(
  currentRows: number,
  addCount: number,
  trimCount: number,
): number {
  if (addCount <= 0 || trimCount <= 1) return currentRows;
  return (currentRows / addCount / trimCount) * (addCount + 1) * (trimCount - 1);
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
  return coverageOrder(leg).slice(0, count);
}

function product(nums: number[]): number {
  return nums.reduce((a, b) => a * b, 1);
}

function projectedRowsForChange(currentRows: number, currentCount: number, nextCount: number): number {
  if (currentCount <= 0) return currentRows;
  return Math.max(1, Math.round((currentRows / currentCount) * nextCount));
}

function rebalanceCoverage(
  legs: LegAnalysis[],
  selections: SystemSelection[],
  counts: number[],
  rows: number,
  maxRows: number,
): boolean {
  let bestShift:
    | {
        addIndex: number;
        trimIndex: number;
        nextRows: number;
      }
    | null = null;
  let bestScore = 8;

  for (let addIndex = 0; addIndex < legs.length; addIndex++) {
    if (selections[addIndex].type !== "gardering") continue;
    if (counts[addIndex] >= maxGuardCount(legs[addIndex])) continue;
    const addLeg = legs[addIndex];
    const addHorse = nextCoverageHorse(addLeg, selections[addIndex].picks);
    if (!addHorse) continue;
    const addScore = horseCoverageScore(addLeg, addHorse) + garderingPriority(addLeg) * 0.55;

    for (let trimIndex = 0; trimIndex < legs.length; trimIndex++) {
      if (trimIndex === addIndex) continue;
      if (selections[trimIndex].type !== "gardering") continue;
      if (counts[trimIndex] <= 1) continue;
      const trimLeg = legs[trimIndex];
      const trimHorse = removableCoverageHorse(trimLeg, selections[trimIndex].picks);
      if (!trimHorse) continue;

      const nextRows = projectedRowsForShift(rows, counts[addIndex], counts[trimIndex]);
      if (nextRows > maxRows) continue;

      const trimCost = horseCoverageScore(trimLeg, trimHorse) + garderingPriority(trimLeg) * 0.45;
      const shiftScore = addScore - trimCost;
      if (shiftScore <= bestScore) continue;

      bestScore = shiftScore;
      bestShift = {
        addIndex,
        trimIndex,
        nextRows,
      };
    }
  }

  if (!bestShift) return false;

  const addLeg = legs[bestShift.addIndex];
  const trimLeg = legs[bestShift.trimIndex];
  const addHorse = nextCoverageHorse(addLeg, selections[bestShift.addIndex].picks);
  const trimHorse = removableCoverageHorse(trimLeg, selections[bestShift.trimIndex].picks);
  if (!addHorse || !trimHorse) return false;

  selections[bestShift.addIndex].picks = coverageOrder(addLeg).slice(0, counts[bestShift.addIndex] + 1);
  counts[bestShift.addIndex] += 1;

  selections[bestShift.trimIndex].picks = selections[bestShift.trimIndex].picks.filter(
    (number) => number !== trimHorse.number,
  );
  counts[bestShift.trimIndex] -= 1;

  return true;
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
          ? skrellHorse.betDistribution <= 10
            ? `Skräll-spik: ${skrellHorse.name} (${skrellHorse.betDistribution.toFixed(1)}% av spelet)`
            : `Värdespik: ${skrellHorse.name} (${skrellHorse.betDistribution.toFixed(1)}% av spelet)`
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
      note = leg.skrellSpike ? "Öppet lopp – bred gardering med skrällskydd" : "Öppet lopp – bred gardering";
    } else if (leg.skrellSpike) {
      note = "Gardering med skrällskydd";
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

  // Utöka garderingar om under budget, prioritera öppna lopp och skrällskydd först.
  while (costKr < options.budgetKr * 0.92 && rows < maxRows) {
    let expanded = false;
    const expandable = legs
      .map((leg, index) => ({ leg, index, priority: garderingPriority(leg) }))
      .filter(({ leg, index }) => {
        if (selections[index].type !== "gardering") return false;
        return selections[index].picks.length < maxGuardCount(leg);
      })
      .sort((a, b) => b.priority - a.priority || a.index - b.index);
    for (const { leg, index } of expandable) {
      const nextCount = selections[index].picks.length + 1;
      const nextRows = projectedRowsForChange(rows, counts[index], nextCount);
      if (nextRows > maxRows) continue;
      selections[index].picks = coverageOrder(leg).slice(0, nextCount);
      counts[index] = nextCount;
      expanded = true;
      break;
    }
    if (!expanded) break;
    rows = product(counts);
    costKr = rows * unitKr;
  }

  // Trimma först mot normal gardering, sedan hårt ned till 1 häst om det krävs för budgettaket.
  while (costKr > options.budgetKr && rows > 1) {
    let trimmed = false;
    const trimmable = legs
      .map((leg, index) => ({ leg, index, priority: garderingPriority(leg) }))
      .filter(({ leg, index }) => {
        if (selections[index].type !== "gardering") return false;
        return selections[index].picks.length > baseGuardCount(leg);
      })
      .sort((a, b) => a.priority - b.priority || a.index - b.index);
    for (const { leg, index } of trimmable) {
      const nextCount = selections[index].picks.length - 1;
      selections[index].picks = coverageOrder(leg).slice(0, nextCount);
      counts[index] = selections[index].picks.length;
      trimmed = true;
      break;
    }
    if (!trimmed) break;
    rows = product(counts);
    costKr = rows * unitKr;
  }

  for (let i = 0; i < 3; i++) {
    if (!rebalanceCoverage(legs, selections, counts, rows, maxRows)) break;
    rows = product(counts);
    costKr = rows * unitKr;
  }

  while (costKr > options.budgetKr && rows > 1) {
    let trimmed = false;
    const emergencyTrimmable = legs
      .map((leg, index) => ({ leg, index, priority: garderingPriority(leg) }))
      .filter(({ index }) => selections[index].type === "gardering" && selections[index].picks.length > 1)
      .sort((a, b) => a.priority - b.priority || a.index - b.index);
    for (const { leg, index } of emergencyTrimmable) {
      const nextCount = selections[index].picks.length - 1;
      selections[index].picks = coverageOrder(leg).slice(0, nextCount);
      counts[index] = nextCount;
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
