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

type SpikeSelection = {
  type: "spik" | "skrell-spik";
  number: number;
};

type CandidateSystemMetrics = {
  expectedCorrect: number;
  probabilityExactlySix: number;
  probabilityExactlySeven: number;
  probabilitySixPlus: number;
  probabilitySevenPlus: number;
  probabilityFull: number;
  averageEdge: number;
  payoutPotential: number;
  budgetUsage: number;
  spikeCount: number;
  coverageBalance: number;
};

type DdCandidateMetrics = {
  hitProbability: number;
  averageEdge: number;
  payoutPotential: number;
  budgetUsage: number;
  longshotRisk: number;
  asymmetryPenalty: number;
  stability: number;
  rowCount: number;
};

export const AUTO_MAIN_POOL_BUDGETS_KR = [600, 700, 800, 900, 1000] as const;
export const AUTO_DD_BUDGETS_KR = [50, 60] as const;

export interface RecommendedMainPoolPlay {
  budgetKr: (typeof AUTO_MAIN_POOL_BUDGETS_KR)[number];
  targetMinPayoutKr: number;
  opennessScore: number;
  reason: string;
  system: BuiltSystem;
}

function rankedHorses(leg: LegAnalysis) {
  return [...leg.horses].sort(
    (a, b) =>
      (a.projectedRank ?? Number.MAX_SAFE_INTEGER) - (b.projectedRank ?? Number.MAX_SAFE_INTEGER) ||
      (b.combinedScore ?? 0) - (a.combinedScore ?? 0),
  );
}

function topModelHorse(leg: LegAnalysis) {
  return rankedHorses(leg)[0] ?? leg.favorite;
}

function secondModelHorse(leg: LegAnalysis) {
  return rankedHorses(leg)[1] ?? null;
}

function modelRankOfHorse(leg: LegAnalysis, horseNumber: number): number {
  const index = rankedHorses(leg).findIndex((horse) => horse.number === horseNumber);
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

function shouldAllowModelSpike(leg: LegAnalysis): boolean {
  const top = topModelHorse(leg);
  const second = secondModelHorse(leg);
  const gap = Math.max(0, (top?.combinedScore ?? 0) - (second?.combinedScore ?? 0));
  const topCombined = top?.combinedScore ?? 0;
  const topBd = top?.betDistribution ?? 0;

  if (leg.recommendation === "spik") return topCombined >= 0.62;
  if (leg.recommendation === "gardering") {
    return topCombined >= 0.75 && gap >= 0.055;
  }

  return scoreModelSpikeLeg(leg) >= 122 && topCombined >= 0.79 && (gap >= 0.08 || topBd >= 56);
}

function shouldAllowValueSpike(leg: LegAnalysis, horse: NonNullable<ReturnType<typeof pickValueSpikeHorse>>): boolean {
  const top = topModelHorse(leg);
  const gapToTop = Math.max(0, (top?.combinedScore ?? 0) - (horse.combinedScore ?? 0));
  return (
    scoreValueSpikeHorse(leg, horse) >= 54 &&
    (horse.valueEdgePct ?? valueEdgeSignal(horse)) >= 2.5 &&
    (horse.estimatedWinPct ?? 0) >= 10 &&
    gapToTop <= 0.11
  );
}

function candidateSpikeOptions(
  legs: LegAnalysis[],
  forceSkrellLeg?: number | null,
): Map<number, SpikeSelection[]> {
  return new Map(
    legs.map((leg) => {
      const valueHorse = pickValueSpikeHorse(leg);
      const choices: SpikeSelection[] = [];
      const topModel = topModelHorse(leg);

      if (shouldAllowModelSpike(leg)) {
        choices.push({ type: "spik", number: topModel.number });
      }

      if (valueHorse && shouldAllowValueSpike(leg, valueHorse)) {
        const exists = choices.some(
          (choice) => choice.type === "skrell-spik" || choice.number === valueHorse.number,
        );
        if (!exists || forceSkrellLeg === leg.leg) {
          choices.push({ type: "skrell-spik", number: valueHorse.number });
        }
      }

      if (forceSkrellLeg === leg.leg && !choices.some((choice) => choice.type === "skrell-spik") && valueHorse) {
        choices.push({ type: "skrell-spik", number: valueHorse.number });
      }

      return [leg.leg, choices];
    }),
  );
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
  return rankedHorses(leg).map((horse) => horse.number);
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

function estimatedHorseWinShare(leg: LegAnalysis, horseNumber: number): number {
  const horse = leg.horses.find((item) => item.number === horseNumber);
  if (!horse) return 0;
  if (horse.estimatedWinPct != null && horse.estimatedWinPct > 0) {
    return horse.estimatedWinPct / 100;
  }
  const totalCombined = leg.horses.reduce((sum, item) => sum + Math.max(0.01, item.combinedScore ?? 0), 0);
  if (totalCombined <= 0) return 1 / Math.max(1, leg.horses.length);
  return Math.max(0.01, horse.combinedScore ?? 0) / totalCombined;
}

function selectedHitProbability(leg: LegAnalysis, picks: number[]): number {
  const prob = picks.reduce((sum, pick) => sum + estimatedHorseWinShare(leg, pick), 0);
  return Math.min(0.985, Math.max(0.02, prob));
}

function selectedMarketShare(leg: LegAnalysis, picks: number[]): number {
  const marketShare = picks.reduce((sum, pick) => {
    const horse = leg.horses.find((item) => item.number === pick);
    return sum + ((horse?.betDistribution ?? 0) / 100);
  }, 0);
  if (marketShare > 0) return Math.min(0.985, marketShare);
  return selectedHitProbability(leg, picks);
}

function poissonBinomialDistribution(probabilities: number[]): number[] {
  const dist = Array(probabilities.length + 1).fill(0);
  dist[0] = 1;
  for (const probability of probabilities) {
    for (let hits = probabilities.length - 1; hits >= 0; hits--) {
      if (dist[hits] === 0) continue;
      dist[hits + 1] += dist[hits] * probability;
      dist[hits] *= 1 - probability;
    }
  }
  return dist;
}

function sumFromIndex(values: number[], startIndex: number): number {
  return values.slice(Math.max(0, startIndex)).reduce((sum, value) => sum + value, 0);
}

function horseMarketShare(leg: LegAnalysis, horseNumber: number): number {
  const horse = leg.horses.find((item) => item.number === horseNumber);
  if (!horse) return 0;
  if (horse.betDistribution > 0) return Math.max(0.0005, horse.betDistribution / 100);
  return estimatedHorseWinShare(leg, horseNumber);
}

function ddHorseSelectionScore(leg: LegAnalysis, horse: LegAnalysis["horses"][number]): number {
  const estimatedWinPct = horse.estimatedWinPct ?? estimatedHorseWinShare(leg, horse.number) * 100;
  const modelRank = modelRankOfHorse(leg, horse.number);
  let score =
    estimatedWinPct * 1.8 +
    (horse.combinedScore ?? 0) * 100 +
    valueEdgeSignal(horse) * 3.1;
  if (modelRank === 1) score += 14;
  else if (modelRank === 2) score += 7;
  if (horse.number === leg.favorite.number) score += 4;
  if (horse.number === leg.skrellSpike?.number) score += 5;
  if (horse.betDistribution > 0 && horse.betDistribution < 4) score -= 18;
  if (estimatedWinPct < 8) score -= 20;
  if (horse.formTrend === "nedåtgående") score -= 12;
  return score;
}

function ddCoverageOrder(leg: LegAnalysis, forceSkrell = false): number[] {
  const ordered = rankedHorses(leg).map((horse) => horse.number);
  if (!forceSkrell || !leg.skrellSpike) return ordered;
  return [leg.skrellSpike.number, ...ordered.filter((number) => number !== leg.skrellSpike!.number)];
}

function buildDdSelection(leg: LegAnalysis, picks: number[]): SystemSelection {
  if (picks.length === 1) {
    const horse = leg.horses.find((item) => item.number === picks[0]) ?? leg.favorite;
    if (leg.skrellSpike?.number === horse.number) {
      return {
        leg: leg.leg,
        picks,
        type: "skrell-spik",
        note:
          horse.betDistribution > 0
            ? `DD-värdespik: ${horse.name} (${horse.betDistribution.toFixed(1)}%)`
            : `DD-värdespik: ${horse.name}`,
      };
    }

    return {
      leg: leg.leg,
      picks,
      type: "spik",
      note:
        horse.betDistribution > 0
          ? `DD-spik: ${horse.name} (${horse.betDistribution.toFixed(1)}%)`
          : `DD-spik: ${horse.name}`,
    };
  }

  const includesSkrell = leg.skrellSpike ? picks.includes(leg.skrellSpike.number) : false;
  return {
    leg: leg.leg,
    picks,
    type: "gardering",
    note:
      picks.length >= 4
        ? includesSkrell
          ? "Bred DD-gardering med värdehäst för stabil träffprofil"
          : "Bred DD-gardering för stabil träffprofil"
        : includesSkrell
          ? "Smal DD-gardering med värdehäst"
          : "Smal DD-gardering",
  };
}

function ddAsymmetryPenalty(
  selections: SystemSelection[],
  legHitProbabilities: number[],
): number {
  const pickCounts = selections.map((selection) => selection.picks.length);
  let penalty = Math.max(0, Math.abs(pickCounts[0] - pickCounts[1]) - 2) * 4;
  for (let index = 0; index < selections.length; index++) {
    if (pickCounts[index] !== 1) continue;
    penalty += Math.max(0, 0.42 - (legHitProbabilities[index] ?? 0)) * 60;
  }
  return penalty;
}

function evaluateDdSystem(
  legs: LegAnalysis[],
  system: BuiltSystem,
  options: BuildOptions,
): DdCandidateMetrics {
  const selections = system.selections;
  const legHitProbabilities = selections.map((selection) => {
    const leg = legs.find((item) => item.leg === selection.leg);
    return leg ? selectedHitProbability(leg, selection.picks) : 0;
  });
  const legMarketShares = selections.map((selection) => {
    const leg = legs.find((item) => item.leg === selection.leg);
    return leg ? selectedMarketShare(leg, selection.picks) : 0;
  });
  const hitProbability = legHitProbabilities.reduce((productValue, value) => productValue * value, 1);

  const firstSelection = selections[0];
  const secondSelection = selections[1];
  const firstLeg = firstSelection ? legs.find((item) => item.leg === firstSelection.leg) ?? null : null;
  const secondLeg = secondSelection ? legs.find((item) => item.leg === secondSelection.leg) ?? null : null;

  let comboEdgeScore = 0;
  let comboPayoutScore = 0;
  let longshotRisk = 0;

  if (firstLeg && secondLeg && firstSelection && secondSelection) {
    for (const firstPick of firstSelection.picks) {
      for (const secondPick of secondSelection.picks) {
        const firstProbability = estimatedHorseWinShare(firstLeg, firstPick);
        const secondProbability = estimatedHorseWinShare(secondLeg, secondPick);
        const firstMarketShare = horseMarketShare(firstLeg, firstPick);
        const secondMarketShare = horseMarketShare(secondLeg, secondPick);
        const comboProbability = firstProbability * secondProbability;
        const comboMarketShare = Math.max(0.00025, firstMarketShare * secondMarketShare);
        const comboEdge = comboProbability / comboMarketShare;

        comboEdgeScore += comboProbability * Math.min(4.5, comboEdge);
        comboPayoutScore += comboProbability * -Math.log(Math.min(0.99, comboMarketShare));

        if (firstProbability < 0.09) longshotRisk += comboProbability * 0.7;
        if (secondProbability < 0.09) longshotRisk += comboProbability * 0.7;
        if (firstMarketShare < 0.05) longshotRisk += comboProbability * 0.35;
        if (secondMarketShare < 0.05) longshotRisk += comboProbability * 0.35;
      }
    }
  }

  const normalizedComboEdge = hitProbability > 0 ? comboEdgeScore / hitProbability : 0;
  const normalizedPayoutPotential = hitProbability > 0 ? comboPayoutScore / hitProbability : 0;
  const averageLegEdge =
    legHitProbabilities.reduce(
      (sum, value, index) => sum + (value - (legMarketShares[index] ?? 0)),
      0,
    ) / Math.max(1, legHitProbabilities.length);
  const asymmetryPenalty = ddAsymmetryPenalty(selections, legHitProbabilities);
  const stability =
    legHitProbabilities.reduce((sum, value) => sum + value, 0) / Math.max(1, legHitProbabilities.length) -
    longshotRisk * 0.25 -
    asymmetryPenalty * 0.01;
  const payoutTargetFactor = Math.min(2.2, Math.max(0.85, options.targetMinPayoutKr / 2_500));

  return {
    hitProbability,
    averageEdge: averageLegEdge + Math.max(0, normalizedComboEdge - 1) * 0.1,
    payoutPotential: normalizedPayoutPotential * payoutTargetFactor,
    budgetUsage: system.costKr / Math.max(1, options.budgetKr),
    longshotRisk,
    asymmetryPenalty,
    stability,
    rowCount: system.rows,
  };
}

function scoreDdSystem(metrics: DdCandidateMetrics): number {
  const budgetBonus = Math.max(0, metrics.budgetUsage - 0.8) * 28;
  return (
    metrics.hitProbability * 820 +
    metrics.averageEdge * 180 +
    metrics.payoutPotential * 34 +
    metrics.stability * 260 +
    budgetBonus -
    metrics.longshotRisk * 130 -
    metrics.asymmetryPenalty * 14
  );
}

type MainPoolLegOption = {
  selection: SystemSelection;
  rowFactor: number;
  localScore: number;
};

type MainPoolSearchState = {
  selections: SystemSelection[];
  rows: number;
  localScore: number;
  spikeCount: number;
  skrellSpikeCount: number;
};

function flexibleGuardMaxCount(leg: LegAnalysis): number {
  const horses = leg.horses.length;
  const openness = leg.opennessScore ?? 0.5;
  if (openness >= 0.72) return Math.min(horses, 7);
  if (openness >= 0.58) return Math.min(horses, 6);
  if (openness >= 0.42) return Math.min(horses, 5);
  return Math.min(horses, 4);
}

function safeMainPoolHorseScore(leg: LegAnalysis, horse: LegAnalysis["horses"][number]): number {
  const estimatedWinPct = horse.estimatedWinPct ?? estimatedHorseWinShare(leg, horse.number) * 100;
  const marketShare = horse.betDistribution ?? 0;
  const edge = valueEdgeSignal(horse);
  return (
    estimatedWinPct * 1.15 +
    marketShare * 0.42 +
    (horse.combinedScore ?? 0) * 42 +
    Math.max(0, edge) * 1.4 -
    Math.max(0, -edge) * 1.1
  );
}

function preferredMainPoolSpikeHorse(leg: LegAnalysis) {
  return topModelHorse(leg);
}

function mainPoolCoverageOrder(leg: LegAnalysis): number[] {
  return coverageOrder(leg);
}

function selectionNoteForLeg(
  leg: LegAnalysis,
  picks: number[],
  type: SystemSelection["type"],
): string {
  if (type === "skrell-spik") {
    const horse = leg.horses.find((item) => item.number === picks[0]) ?? leg.skrellSpike ?? leg.favorite;
    return horse.betDistribution > 0
      ? `Värdespik från rank: ${horse.name} (${horse.betDistribution.toFixed(1)}%)`
      : `Värdespik från rank: ${horse.name}`;
  }
  if (type === "spik") {
    const horse = leg.horses.find((item) => item.number === picks[0]) ?? topModelHorse(leg);
    return horse.betDistribution > 0
      ? `Modellspik från rank: ${horse.name} (${horse.betDistribution.toFixed(1)}%)`
      : `Modellspik från rank: ${horse.name}`;
  }
  const topNames = picks
    .map((pick) => leg.horses.find((horse) => horse.number === pick)?.name)
    .filter(Boolean)
    .slice(0, 2);
  return topNames.length > 0
    ? `Gardering från rank: ${topNames.join(" + ")}${picks.length > 2 ? " och fler" : ""}`
    : `Gardering från rank med ${picks.length} hästar`;
}

function normalizeSelectionForLeg(
  leg: LegAnalysis,
  selection: SystemSelection,
): SystemSelection {
  if (selection.picks.length > 1) {
    return {
      ...selection,
      type: "gardering",
      note: selectionNoteForLeg(leg, selection.picks, "gardering"),
    };
  }
  if (selection.picks.length !== 1) return selection;
  const [pick] = selection.picks;
  const type: SystemSelection["type"] =
    leg.skrellSpike?.number === pick ? "skrell-spik" : "spik";
  return {
    ...selection,
    type,
    note: selectionNoteForLeg(leg, selection.picks, type),
  };
}

function buildMainPoolLegOptions(
  leg: LegAnalysis,
  forceSkrellLeg = false,
): MainPoolLegOption[] {
  const coverage = mainPoolCoverageOrder(leg);
  const options: MainPoolLegOption[] = [];
  const seen = new Set<string>();
  const openness = leg.opennessScore ?? 0.5;
  const bankability = leg.bankabilityScore ?? 0.5;

  const pushOption = (picks: number[], type: SystemSelection["type"]) => {
    const normalizedPicks = picks.filter((pick, index) => picks.indexOf(pick) === index);
    if (normalizedPicks.length === 0) return;
    const key = `${type}:${normalizedPicks.join(",")}`;
    if (seen.has(key)) return;
    seen.add(key);

    const hitProbability = selectedHitProbability(leg, normalizedPicks);
    const marketShare = selectedMarketShare(leg, normalizedPicks);
    const antiCrowd = -Math.log(Math.min(0.985, Math.max(0.03, marketShare)));
    const edge = hitProbability - marketShare;
    const spikeHorse =
      normalizedPicks.length === 1
        ? leg.horses.find((horse) => horse.number === normalizedPicks[0]) ?? null
        : null;
    const spikeWinPct = spikeHorse?.estimatedWinPct ?? 0;
    const spikeBd = spikeHorse?.betDistribution ?? 0;
    const coveragePenalty =
      normalizedPicks.length > 1
        ? (normalizedPicks.length - 2) * (6 + Math.max(0, 0.55 - openness) * 10)
        : 0;
    const spikeBonus =
      type === "spik"
        ? bankability * 18 + hitProbability * 12
        : type === "skrell-spik"
          ? Math.max(0, edge) * 18 +
            Math.max(0, spikeWinPct - 12) * 0.8 -
            Math.max(0, 14 - spikeWinPct) * 4 -
            Math.max(0, 5 - spikeBd) * 4
          : 0;
    const spikeRiskPenalty =
      spikeHorse == null
        ? 0
        : type === "spik"
          ? Math.max(0, 22 - spikeWinPct) * 6 + (spikeBd > 0 ? Math.max(0, 15 - spikeBd) * 4 : 0)
          : Math.max(0, 16 - spikeWinPct) * 4 + (spikeBd > 0 ? Math.max(0, 8 - spikeBd) * 3.5 : 0);
    const structuralSpikePenalty =
      spikeHorse == null
        ? 0
        : type === "spik"
          ? Math.max(0, 0.72 - bankability) * 90
          : Math.max(0, 0.66 - bankability) * 110;

    options.push({
      selection: {
        leg: leg.leg,
        picks: normalizedPicks,
        type,
        note: selectionNoteForLeg(leg, normalizedPicks, type),
      },
      rowFactor: normalizedPicks.length,
      localScore:
        hitProbability * 175 +
        edge * 54 +
        antiCrowd * (type === "gardering" ? 7 + openness * 3 : 4) +
        spikeBonus -
        coveragePenalty -
        spikeRiskPenalty -
        structuralSpikePenalty,
    });
  };

  const preferredSpike = preferredMainPoolSpikeHorse(leg);
  const topModel = topModelHorse(leg);
  pushOption([preferredSpike.number], "spik");
  if (topModel.number !== preferredSpike.number) {
    pushOption([topModel.number], "spik");
  }

  const valueHorse = pickValueSpikeHorse(leg) ?? leg.skrellSpike;
  if (forceSkrellLeg) {
    const forcedHorse =
      valueHorse ??
      leg.skrellSpike ??
      leg.horses.find((horse) => horse.number !== leg.favorite.number) ??
      topModel;
    return [
      {
        selection: {
          leg: leg.leg,
          picks: [forcedHorse.number],
          type: "skrell-spik",
          note: selectionNoteForLeg(leg, [forcedHorse.number], "skrell-spik"),
        },
        rowFactor: 1,
        localScore: 70 + Math.max(0, valueEdgeSignal(forcedHorse)) * 4,
      },
    ];
  }
  if (valueHorse && valueHorse.number !== topModel.number) {
    pushOption([valueHorse.number], "skrell-spik");
  }

  const maxGuardCount = flexibleGuardMaxCount(leg);
  for (let count = 2; count <= maxGuardCount; count++) {
    pushOption(coverage.slice(0, count), "gardering");
  }

  const ordered = options.sort(
    (a, b) =>
      b.localScore - a.localScore ||
      a.rowFactor - b.rowFactor ||
      a.selection.leg - b.selection.leg,
  );
  const spikeOptions = ordered.filter((option) => option.selection.type !== "gardering");
  const guardOptions = ordered.filter((option) => option.selection.type === "gardering");
  return [...spikeOptions, ...guardOptions.slice(0, Math.max(2, 6 - spikeOptions.length))];
}

function buildSystemFromSelections(
  gameId: string,
  gameType: PoolGameType,
  legs: LegAnalysis[],
  options: BuildOptions,
  selections: SystemSelection[],
): BuiltSystem {
  const normalizedSelections = selections.map((selection) => {
    const leg = legs.find((item) => item.leg === selection.leg);
    return leg ? normalizeSelectionForLeg(leg, selection) : selection;
  });
  const unitKr = rowPriceKr(gameType);
  const rows = product(normalizedSelections.map((selection) => selection.picks.length));
  const costKr = rows * unitKr;
  const gameLabel = gameType === "dd" ? "Dagens Dubbel" : gameType;
  return {
    gameId,
    gameType,
    budgetKr: options.budgetKr,
    rows,
    costKr,
    targetMinPayoutKr: options.targetMinPayoutKr,
    estimatedPayoutNote:
      `Mål: utdelning ≥ ${options.targetMinPayoutKr.toLocaleString("sv-SE")} kr vid fullträff (${gameLabel}). ` +
      `ATG garanterar inte min utdelning – se atg.se. ` +
      `System: ${rows} rader × ${unitKr} kr = ${costKr.toFixed(2)} kr.`,
    selections: normalizedSelections,
    skrellSpikeLeg: normalizedSelections.find((selection) => selection.type === "skrell-spik")?.leg ?? null,
  };
}

function evaluateMainPoolSystem(
  legs: LegAnalysis[],
  system: BuiltSystem,
  options: BuildOptions,
): CandidateSystemMetrics {
  const probabilities: number[] = [];
  const marketShares: number[] = [];
  const legEdges: number[] = [];

  for (const selection of system.selections) {
    const leg = legs.find((item) => item.leg === selection.leg);
    if (!leg) continue;
    const hitProbability = selectedHitProbability(leg, selection.picks);
    const marketShare = selectedMarketShare(leg, selection.picks);
    probabilities.push(hitProbability);
    marketShares.push(marketShare);
    legEdges.push(hitProbability - marketShare);
  }

  const hitDistribution = poissonBinomialDistribution(probabilities);
  const totalLegs = probabilities.length;
  const averageProbability =
    probabilities.reduce((sum, value) => sum + value, 0) / Math.max(1, probabilities.length);
  const probabilityVariance =
    probabilities.reduce((sum, value) => sum + Math.pow(value - averageProbability, 2), 0) /
    Math.max(1, probabilities.length);
  const payoutTargetFactor = Math.min(1.8, Math.max(0.9, options.targetMinPayoutKr / 50_000));
  const antiCrowdScore =
    marketShares.reduce((sum, share) => sum + -Math.log(Math.min(0.985, Math.max(0.03, share))), 0) /
    Math.max(1, marketShares.length);
  const spikeSelections = system.selections.filter((selection) => selection.type !== "gardering");
  const spikeMarketPressure =
    spikeSelections.reduce((sum, selection) => {
      const leg = legs.find((item) => item.leg === selection.leg);
      if (!leg) return sum;
      return sum + Math.max(0, 0.28 - selectedMarketShare(leg, selection.picks));
    }, 0) / Math.max(1, spikeSelections.length || 1);

  return {
    expectedCorrect: probabilities.reduce((sum, value) => sum + value, 0),
    probabilityExactlySix: hitDistribution[Math.max(0, totalLegs - 2)] ?? 0,
    probabilityExactlySeven: hitDistribution[Math.max(0, totalLegs - 1)] ?? 0,
    probabilitySixPlus: sumFromIndex(hitDistribution, Math.max(0, totalLegs - 2)),
    probabilitySevenPlus: sumFromIndex(hitDistribution, Math.max(0, totalLegs - 1)),
    probabilityFull: hitDistribution[totalLegs] ?? 0,
    averageEdge: legEdges.reduce((sum, value) => sum + value, 0) / Math.max(1, legEdges.length),
    payoutPotential: antiCrowdScore * 0.65 + spikeMarketPressure * (1.8 * payoutTargetFactor),
    budgetUsage: system.costKr / Math.max(1, options.budgetKr),
    spikeCount: spikeSelections.length,
    coverageBalance: Math.max(0, 1 - Math.sqrt(probabilityVariance) / 0.24),
  };
}

function scoreMainPoolSystem(metrics: CandidateSystemMetrics): number {
  const budgetBonus = Math.max(0, metrics.budgetUsage - 0.82) * 42;
  const spikePenalty = metrics.spikeCount >= 6 ? (metrics.spikeCount - 5) * 10 : 0;
  const noSpikePenalty = metrics.spikeCount === 0 ? 4 : 0;
  return (
    metrics.expectedCorrect * 10 +
    metrics.probabilitySixPlus * 340 +
    metrics.probabilityExactlySix * 180 +
    metrics.probabilitySevenPlus * 250 +
    metrics.probabilityExactlySeven * 140 +
    metrics.probabilityFull * 420 +
    metrics.averageEdge * 150 +
    metrics.payoutPotential * 58 +
    metrics.coverageBalance * 120 +
    budgetBonus -
    spikePenalty -
    noSpikePenalty
  );
}

function mainPoolCandidateScore(
  legs: LegAnalysis[],
  candidate: BuiltSystem,
  options: BuildOptions,
  stateLocalScore = 0,
): number {
  const metrics = evaluateMainPoolSystem(legs, candidate, options);
  const underusePenalty = Math.max(0, 0.86 - metrics.budgetUsage) * 175;
  const spikeOverloadPenalty = Math.max(0, metrics.spikeCount - 5) * 8;
  const riskySinglePickPenalty = candidate.selections.reduce((sum, selection) => {
    if (selection.picks.length !== 1) return sum;
    const leg = legs.find((item) => item.leg === selection.leg);
    const horse = leg?.horses.find((item) => item.number === selection.picks[0]);
    if (!horse) return sum;
    const winPct = horse.estimatedWinPct ?? 0;
    const market = horse.betDistribution ?? 0;
    const bankability = leg?.bankabilityScore ?? 0.5;
    return (
      sum +
      Math.max(0, 20 - winPct) * 8 +
      (market > 0 ? Math.max(0, 12 - market) * 5 : 0) +
      Math.max(0, 0.7 - bankability) * 60
    );
  }, 0);
  const skrellSpikePenalty =
    Math.max(
      0,
      candidate.selections.filter((selection) => selection.type === "skrell-spik").length - 1,
    ) * 36;
  return (
    scoreMainPoolSystem(metrics) +
    stateLocalScore -
    underusePenalty -
    spikeOverloadPenalty -
    skrellSpikePenalty -
    riskySinglePickPenalty
  );
}

function opennessScore(legs: LegAnalysis[]): number {
  if (legs.length === 0) return 0;
  const openLegs = legs.filter((leg) => leg.recommendation === "bred").length;
  const valueLegs = legs.filter((leg) => leg.skrellSpike != null).length;
  const lowFavoriteLegs = legs.filter((leg) => (leg.favorite.betDistribution ?? 0) > 0 && (leg.favorite.betDistribution ?? 0) < 30).length;
  const avgFavoriteShare =
    legs.reduce((sum, leg) => sum + Math.min(60, Math.max(0, leg.favorite.betDistribution ?? 0)), 0) /
    legs.length;
  return Math.max(
    0,
    Math.min(
      1,
      openLegs / legs.length * 0.45 +
        valueLegs / legs.length * 0.25 +
        lowFavoriteLegs / legs.length * 0.15 +
        Math.max(0, 34 - avgFavoriteShare) / 34 * 0.15,
    ),
  );
}

function preferredBudgetFromOpenness(score: number): (typeof AUTO_MAIN_POOL_BUDGETS_KR)[number] {
  if (score >= 0.9) return 1000;
  if (score >= 0.8) return 900;
  if (score >= 0.7) return 800;
  if (score >= 0.58) return 700;
  return 600;
}

function buildRecommendationReason(
  budgetKr: number,
  targetMinPayoutKr: number,
  metrics: CandidateSystemMetrics,
  openness: number,
  preferredBudget: number,
): string {
  const opennessText =
    openness >= 0.68
      ? "Mycket öppen omgång"
      : openness >= 0.52
        ? "Ganska öppen omgång"
        : "Relativt tydlig omgång";
  const usageText =
    metrics.budgetUsage >= 0.95
      ? "systemet använder nästan hela budgeten effektivt"
      : metrics.budgetUsage >= 0.88
        ? "systemet använder större delen av budgeten"
        : "högre budget gav inte nog mycket extra täckning";
  const stabilityText =
    metrics.probabilitySixPlus >= 0.22
      ? "träffprofilen är ovanligt stabil"
      : metrics.probabilitySixPlus >= 0.16
        ? "träffprofilen är rimligt stabil"
        : "träffprofilen är fortfarande ganska spetsig";
  const spikeText =
    metrics.spikeCount === 0
      ? "utan spikar"
      : metrics.spikeCount === 1
        ? "med en spik"
        : `med ${metrics.spikeCount} spikar`;
  const budgetText =
    budgetKr === preferredBudget
      ? `${budgetKr} kr matchar loppens öppenhet bäst`
      : `${budgetKr} kr slog de andra nivåerna trots att ${preferredBudget} kr låg närmast öppningsprofilen`;
  return `${opennessText}: ${budgetText}, ${usageText}, ${stabilityText} och modellen landar ${spikeText}. Målutdelning hålls på minst ${targetMinPayoutKr.toLocaleString("sv-SE")} kr.`;
}

export function recommendMainPoolPlay(
  gameId: string,
  gameType: PoolGameType,
  legs: LegAnalysis[],
  minTargetMinPayoutKr = 30_000,
): RecommendedMainPoolPlay | null {
  if (gameType === "dd") return null;

  const targetMinPayoutKr = Math.max(30_000, minTargetMinPayoutKr);
  const openness = opennessScore(legs);
  const preferredBudget = preferredBudgetFromOpenness(openness);
  let best:
    | {
        budgetKr: (typeof AUTO_MAIN_POOL_BUDGETS_KR)[number];
        system: BuiltSystem;
        metrics: CandidateSystemMetrics;
        score: number;
      }
    | null = null;

  for (const budgetKr of AUTO_MAIN_POOL_BUDGETS_KR) {
    const system = buildSystem(gameId, gameType, legs, {
      budgetKr,
      targetMinPayoutKr,
    });
    const metrics = evaluateMainPoolSystem(legs, system, {
      budgetKr,
      targetMinPayoutKr,
    });
    const underusePenalty = Math.max(0, 0.94 - metrics.budgetUsage) * 120;
    const distancePenalty = Math.abs(budgetKr - preferredBudget) / 100 * 9;
    const costPenalty = (budgetKr - 600) / 100 * 6;
    const stabilityBias =
      metrics.probabilitySixPlus * 170 +
      metrics.coverageBalance * 75 -
      Math.max(0, metrics.spikeCount - 2) * 18;
    const unstableHighBudgetPenalty =
      budgetKr > 600
        ? Math.max(0, 0.16 - metrics.probabilitySixPlus) * 380 +
          Math.max(0, metrics.spikeCount - 2) * 16
        : 0;
    const score =
      scoreMainPoolSystem(metrics) +
      stabilityBias -
      underusePenalty -
      distancePenalty -
      costPenalty -
      unstableHighBudgetPenalty;
    if (!best || score > best.score) {
      best = { budgetKr, system, metrics, score };
    }
  }

  if (!best) return null;

  return {
    budgetKr: best.budgetKr,
    targetMinPayoutKr,
    opennessScore: Math.round(openness * 100) / 100,
    reason: buildRecommendationReason(
      best.budgetKr,
      targetMinPayoutKr,
      best.metrics,
      openness,
      preferredBudget,
    ),
    system: best.system,
  };
}

function buildDdRecommendationReason(
  budgetKr: (typeof AUTO_DD_BUDGETS_KR)[number],
  targetMinPayoutKr: number,
  system: BuiltSystem,
  metrics: DdCandidateMetrics,
): string {
  const hitRateText = `${Math.round(metrics.hitProbability * 100)}% modellträff på kupongen`;
  const structureText = system.selections.some((selection) => selection.type !== "gardering")
    ? "en tydlig DD-spikprofil"
    : "en helt garderad DD-profil";
  return `${budgetKr} kr gav bäst balans mellan ${structureText}, ${hitRateText} och en rimlig chans att nå minst ${targetMinPayoutKr.toLocaleString("sv-SE")} kr vid träff.`;
}

export function recommendDdPlay(
  gameId: string,
  gameType: PoolGameType,
  legs: LegAnalysis[],
  minTargetMinPayoutKr = 1_500,
): RecommendedMainPoolPlay | null {
  if (gameType !== "dd") return null;

  const targetMinPayoutKr = Math.max(1_000, minTargetMinPayoutKr);
  let best:
    | {
        budgetKr: (typeof AUTO_DD_BUDGETS_KR)[number];
        system: BuiltSystem;
        metrics: DdCandidateMetrics;
        score: number;
      }
    | null = null;

  for (const budgetKr of AUTO_DD_BUDGETS_KR) {
    const system = buildDdSystem(gameId, gameType, legs, {
      budgetKr,
      targetMinPayoutKr,
    });
    const metrics = evaluateDdSystem(legs, system, {
      budgetKr,
      targetMinPayoutKr,
    });
    const score = scoreDdSystem(metrics) - (budgetKr === 60 ? 4 : 0);
    if (!best || score > best.score) {
      best = { budgetKr, system, metrics, score };
    }
  }

  if (!best) return null;

  return {
    budgetKr: best.budgetKr,
    targetMinPayoutKr,
    opennessScore: Math.round(best.metrics.hitProbability * 100) / 100,
    reason: buildDdRecommendationReason(
      best.budgetKr,
      targetMinPayoutKr,
      best.system,
      best.metrics,
    ),
    system: best.system,
  };
}

function buildDdSystem(
  gameId: string,
  gameType: PoolGameType,
  legs: LegAnalysis[],
  options: BuildOptions,
): BuiltSystem {
  const unitKr = rowPriceKr(gameType);
  const maxRows = Math.max(1, Math.floor(options.budgetKr / unitKr));
  const ddLegs = legs.slice(0, 2);

  if (ddLegs.length < 2) {
    return buildCandidateSystem(gameId, gameType, legs, options);
  }

  const coverageOrders = ddLegs.map((leg) =>
    ddCoverageOrder(leg, options.forceSkrellLeg != null && options.forceSkrellLeg === leg.leg),
  );
  let best:
    | {
        system: BuiltSystem;
        score: number;
      }
    | null = null;

  for (let firstCount = 1; firstCount <= Math.min(maxRows, coverageOrders[0].length); firstCount++) {
    for (
      let secondCount = 1;
      secondCount <= Math.min(Math.max(1, Math.floor(maxRows / firstCount)), coverageOrders[1].length);
      secondCount++
    ) {
      const rows = firstCount * secondCount;
      if (rows > maxRows) continue;

      const selections = [
        buildDdSelection(ddLegs[0], coverageOrders[0].slice(0, firstCount)),
        buildDdSelection(ddLegs[1], coverageOrders[1].slice(0, secondCount)),
      ];
      const costKr = rows * unitKr;
      const system: BuiltSystem = {
        gameId,
        gameType,
        budgetKr: options.budgetKr,
        rows,
        costKr,
        targetMinPayoutKr: options.targetMinPayoutKr,
        estimatedPayoutNote:
          `Mål: utdelning ≥ ${options.targetMinPayoutKr.toLocaleString("sv-SE")} kr vid DD-träff. ` +
          `System: ${rows} rader × ${unitKr} kr = ${costKr.toFixed(2)} kr.`,
        selections,
        skrellSpikeLeg:
          selections.find((selection) => selection.type === "skrell-spik")?.leg ?? null,
      };
      const metrics = evaluateDdSystem(ddLegs, system, options);
      const rowsPenalty = rows < Math.max(1, maxRows - 1) ? (Math.max(1, maxRows - 1) - rows) * 18 : 0;
      const score = scoreDdSystem(metrics) - rowsPenalty;

      if (!best || score > best.score) {
        best = { system, score };
      }
    }
  }

  return best?.system ?? buildCandidateSystem(gameId, gameType, legs, options);
}

function buildCandidateSystem(
  gameId: string,
  gameType: PoolGameType,
  legs: LegAnalysis[],
  options: BuildOptions,
  forcedSpikes?: Map<number, SpikeSelection>,
): BuiltSystem {
  const isMainPool = gameType !== "dd";
  const unitKr = rowPriceKr(gameType);
  const maxRows = Math.floor(options.budgetKr / unitKr);
  const skrellLegAnalysis =
    isMainPool
      ? legs.find((leg) => forcedSpikes?.get(leg.leg)?.type === "skrell-spik") ?? null
      : options.forceSkrellLeg != null
        ? legs.find((l) => l.leg === options.forceSkrellLeg) ?? null
        : legs.find((l) => l.skrellSpike && l.recommendation !== "spik") ?? null;

  const selections: SystemSelection[] = [];
  const counts: number[] = [];

  for (const leg of legs) {
    let mode: SystemSelection["type"] = "gardering";
    let note: string | undefined;
    let fixedNumber: number | undefined;
    const forcedSpike = forcedSpikes?.get(leg.leg);

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
  const normalizedSelections = selections.map((selection) => {
    const leg = legs.find((item) => item.leg === selection.leg);
    return leg ? normalizeSelectionForLeg(leg, selection) : selection;
  });
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
    selections: normalizedSelections,
    skrellSpikeLeg: normalizedSelections.find((selection) => selection.type === "skrell-spik")?.leg ?? null,
  };
}

function pickBestIndependentMainPoolSystem(
  gameId: string,
  gameType: PoolGameType,
  legs: LegAnalysis[],
  options: BuildOptions,
): BuiltSystem {
  const unitKr = rowPriceKr(gameType);
  const maxRows = Math.max(1, Math.floor(options.budgetKr / unitKr));
  const legOptions = legs.map((leg) =>
    buildMainPoolLegOptions(leg, options.forceSkrellLeg != null && options.forceSkrellLeg === leg.leg),
  );
  const beamWidth = 180;
  let states: MainPoolSearchState[] = [
    {
      selections: [],
      rows: 1,
      localScore: 0,
      spikeCount: 0,
      skrellSpikeCount: 0,
    },
  ];

  for (let legIndex = 0; legIndex < legs.length; legIndex++) {
    const nextStates: MainPoolSearchState[] = [];
    for (const state of states) {
      for (const option of legOptions[legIndex] ?? []) {
        const nextRows = state.rows * option.rowFactor;
        if (nextRows > maxRows) continue;
        const nextSelections = [...state.selections, option.selection];
        nextStates.push({
          selections: nextSelections,
          rows: nextRows,
          localScore:
            state.localScore +
            option.localScore +
            Math.min(10, (nextRows / Math.max(1, maxRows)) * 8) -
            Math.max(0, state.spikeCount + (option.selection.type !== "gardering" ? 1 : 0) - 4) * 6 -
            Math.max(0, state.skrellSpikeCount + (option.selection.type === "skrell-spik" ? 1 : 0) - 1) * 24,
          spikeCount: state.spikeCount + (option.selection.type !== "gardering" ? 1 : 0),
          skrellSpikeCount: state.skrellSpikeCount + (option.selection.type === "skrell-spik" ? 1 : 0),
        });
      }
    }

    states = nextStates
      .sort((a, b) => b.localScore - a.localScore || b.rows - a.rows)
      .slice(0, beamWidth);
    if (states.length === 0) break;
  }

  let bestSystem: BuiltSystem | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;
  const completedStates = states.filter((state) => state.selections.length === legs.length);

  for (const state of completedStates) {
    const candidate = buildSystemFromSelections(gameId, gameType, legs, options, state.selections);
    const score = mainPoolCandidateScore(legs, candidate, options, state.localScore);
    if (Number.isFinite(score) && score > bestScore) {
      bestScore = score;
      bestSystem = candidate;
    }
  }

  const legacySystem = buildCandidateSystem(gameId, gameType, legs, options);
  const legacyScore = mainPoolCandidateScore(legs, legacySystem, options);
  if (Number.isFinite(legacyScore) && legacyScore > bestScore) {
    bestScore = legacyScore;
    bestSystem = legacySystem;
  }

  if (!bestSystem && completedStates.length > 0) {
    const fallbackState = [...completedStates].sort((a, b) => b.localScore - a.localScore || b.rows - a.rows)[0]!;
    return buildSystemFromSelections(gameId, gameType, legs, options, fallbackState.selections);
  }

  return bestSystem ?? legacySystem;
}

function expandedPicksForLeg(
  leg: LegAnalysis,
  currentPicks: number[],
  addedNumber: number,
): number[] {
  const selected = new Set([...currentPicks, addedNumber]);
  return coverageOrder(leg).filter((number) => selected.has(number));
}

function expandMainPoolSystemToBudget(
  gameId: string,
  gameType: PoolGameType,
  legs: LegAnalysis[],
  baseSystem: BuiltSystem,
  options: BuildOptions,
): BuiltSystem {
  const unitKr = rowPriceKr(gameType);
  const maxRows = Math.max(1, Math.floor(options.budgetKr / unitKr));
  const selections = baseSystem.selections.map((selection) => ({
    ...selection,
    picks: [...selection.picks],
  }));
  let rows = product(selections.map((selection) => selection.picks.length));
  let costKr = rows * unitKr;

  while (costKr < options.budgetKr * 0.92 && rows < maxRows) {
    let bestExpansion:
      | {
          index: number;
          nextRows: number;
          nextPicks: number[];
          score: number;
        }
      | null = null;

    for (let index = 0; index < legs.length; index++) {
      const leg = legs[index];
      const selection = selections[index];
      if (!selection) continue;
      const nextHorse = nextCoverageHorse(leg, selection.picks);
      if (!nextHorse) continue;

      const nextCount = selection.picks.length + 1;
      const nextRows = projectedRowsForChange(rows, selection.picks.length, nextCount);
      if (nextRows > maxRows) continue;

      const score =
        horseCoverageScore(leg, nextHorse) +
        garderingPriority(leg) * 0.55 +
        (selection.picks.length === 1 ? 8 : 0) +
        (selection.type === "skrell-spik" ? 6 : selection.type === "spik" ? 4 : 0);

      if (!bestExpansion || score > bestExpansion.score) {
        bestExpansion = {
          index,
          nextRows,
          nextPicks: expandedPicksForLeg(leg, selection.picks, nextHorse.number),
          score,
        };
      }
    }

    if (!bestExpansion) break;

    selections[bestExpansion.index] = {
      ...selections[bestExpansion.index],
      picks: bestExpansion.nextPicks,
    };
    rows = bestExpansion.nextRows;
    costKr = rows * unitKr;
  }

  return buildSystemFromSelections(gameId, gameType, legs, options, selections);
}

function buildHierarchicalMainPoolSystem(
  gameId: string,
  gameType: PoolGameType,
  legs: LegAnalysis[],
  options: BuildOptions,
): BuiltSystem {
  // Global invariant for main pools: larger budgets must preserve the smaller
  // system's picks and only add coverage from the same ranked horse list.
  const progressiveBudgets = AUTO_MAIN_POOL_BUDGETS_KR.filter((budgetKr) => budgetKr <= options.budgetKr);
  if (progressiveBudgets.length === 0) {
    return pickBestIndependentMainPoolSystem(gameId, gameType, legs, options);
  }

  const [baseBudget, ...nextBudgets] = progressiveBudgets;
  let system = pickBestIndependentMainPoolSystem(gameId, gameType, legs, {
    ...options,
    budgetKr: baseBudget,
  });

  for (const budgetKr of nextBudgets) {
    system = expandMainPoolSystemToBudget(gameId, gameType, legs, system, {
      ...options,
      budgetKr,
    });
  }

  return system;
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

/** Bygger V85/V86-system inom budget och vagar gardering mot dynamiska spikar. */
export function buildSystem(
  gameId: string,
  gameType: PoolGameType,
  legs: LegAnalysis[],
  options: BuildOptions,
): BuiltSystem {
  if (gameType !== "dd") {
    return buildHierarchicalMainPoolSystem(gameId, gameType, legs, options);
  }
  return buildDdSystem(gameId, gameType, legs, options);
}
