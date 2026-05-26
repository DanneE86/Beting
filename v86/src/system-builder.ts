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
  probabilitySixPlus: number;
  probabilitySevenPlus: number;
  probabilityFull: number;
  averageEdge: number;
  payoutPotential: number;
  budgetUsage: number;
  spikeCount: number;
};

export const AUTO_MAIN_POOL_BUDGETS_KR = [600, 700, 800, 900, 1000] as const;

export interface RecommendedMainPoolPlay {
  budgetKr: (typeof AUTO_MAIN_POOL_BUDGETS_KR)[number];
  targetMinPayoutKr: number;
  opennessScore: number;
  reason: string;
  system: BuiltSystem;
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
    probabilitySixPlus: sumFromIndex(hitDistribution, Math.max(0, totalLegs - 2)),
    probabilitySevenPlus: sumFromIndex(hitDistribution, Math.max(0, totalLegs - 1)),
    probabilityFull: hitDistribution[totalLegs] ?? 0,
    averageEdge: legEdges.reduce((sum, value) => sum + value, 0) / Math.max(1, legEdges.length),
    payoutPotential: antiCrowdScore * 0.65 + spikeMarketPressure * (1.8 * payoutTargetFactor),
    budgetUsage: system.costKr / Math.max(1, options.budgetKr),
    spikeCount: spikeSelections.length,
  };
}

function scoreMainPoolSystem(metrics: CandidateSystemMetrics): number {
  const budgetBonus = Math.max(0, metrics.budgetUsage - 0.82) * 24;
  const spikePenalty = metrics.spikeCount >= 4 ? (metrics.spikeCount - 3) * 18 : 0;
  const noSpikePenalty = metrics.spikeCount === 0 ? 8 : 0;
  return (
    metrics.expectedCorrect * 16 +
    metrics.probabilitySixPlus * 230 +
    metrics.probabilitySevenPlus * 420 +
    metrics.probabilityFull * 900 +
    metrics.averageEdge * 160 +
    metrics.payoutPotential * 62 +
    budgetBonus -
    spikePenalty -
    noSpikePenalty
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
  if (score >= 0.78) return 1000;
  if (score >= 0.68) return 900;
  if (score >= 0.58) return 800;
  if (score >= 0.46) return 700;
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
  return `${opennessText}: ${budgetText}, ${usageText} och modellen landar ${spikeText}. Målutdelning hålls på minst ${targetMinPayoutKr.toLocaleString("sv-SE")} kr.`;
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
    const distancePenalty = Math.abs(budgetKr - preferredBudget) / 100 * 7;
    const costPenalty = (budgetKr - 600) / 100 * 2.5;
    const score = scoreMainPoolSystem(metrics) - underusePenalty - distancePenalty - costPenalty;
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

function pickBestMainPoolSystem(
  gameId: string,
  gameType: PoolGameType,
  legs: LegAnalysis[],
  options: BuildOptions,
): BuiltSystem {
  const spikeOptionsByLeg = candidateSpikeOptions(legs, options.forceSkrellLeg ?? null);
  const chosen = new Map<number, SpikeSelection>();
  let bestSystem: BuiltSystem | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;

  function visit(legIndex: number, spikeCount: number) {
    if (legIndex >= legs.length) {
      if (options.forceSkrellLeg != null) {
        const forcedChoice = chosen.get(options.forceSkrellLeg);
        if (!forcedChoice || forcedChoice.type !== "skrell-spik") return;
      }
      const forcedSpikes = new Map(chosen);
      const candidate = buildCandidateSystem(gameId, gameType, legs, options, forcedSpikes);
      const metrics = evaluateMainPoolSystem(legs, candidate, options);
      const score = scoreMainPoolSystem(metrics);
      if (score > bestScore) {
        bestScore = score;
        bestSystem = candidate;
      }
      return;
    }

    const leg = legs[legIndex];
    const optionsForLeg = spikeOptionsByLeg.get(leg.leg) ?? [];

    if (options.forceSkrellLeg !== leg.leg || optionsForLeg.some((choice) => choice.type === "skrell-spik")) {
      chosen.delete(leg.leg);
      visit(legIndex + 1, spikeCount);
    }

    if (spikeCount >= 3) return;

    for (const choice of optionsForLeg) {
      chosen.set(leg.leg, choice);
      visit(legIndex + 1, spikeCount + 1);
    }
    chosen.delete(leg.leg);
  }

  visit(0, 0);
  return bestSystem ?? buildCandidateSystem(gameId, gameType, legs, options);
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
    return pickBestMainPoolSystem(gameId, gameType, legs, options);
  }
  return buildCandidateSystem(gameId, gameType, legs, options);
}
