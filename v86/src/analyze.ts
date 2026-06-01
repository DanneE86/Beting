import { activeStarts, betDistribution, winOdds } from "./atg-api";
import { scoreStartFull } from "./scoring";
import type { TravsportIndex } from "./travsport/types";
import { normalizeTravRuleId } from "./rules";
import type {
  AtgGame,
  AtgRace,
  AtgStart,
  ChecklistItemView,
  LegAnalysis,
  PoolGameType,
  ScoredHorse,
  TravRuleId,
} from "./types";

function mapChecklist(
  items: { id: string; category: "häst" | "kusk"; label: string; score: number; available: boolean; note: string }[],
): ChecklistItemView[] {
  return items.map((i) => ({
    id: i.id,
    category: i.category,
    label: i.label,
    score: i.score,
    available: i.available,
    note: i.note,
  }));
}

function scoreStart(
  start: AtgStart,
  race: AtgRace,
  field: AtgStart[],
  gameType: PoolGameType,
  travsportIndex: TravsportIndex | undefined,
  ruleId: TravRuleId,
): ScoredHorse {
  const bd = betDistribution(start, gameType);
  const winPct = (start.horse?.statistics?.life?.winPercentage ?? 0) / 100;
  const eps = (start.horse?.statistics?.life?.earningsPerStart ?? 0) / 100;
  const full = scoreStartFull(start, race, field, gameType, travsportIndex, ruleId);
  const ts = start.horse?.id ? travsportIndex?.[start.horse.id] : undefined;
  const recentKmTimes = ts?.recentStarts
    ?.map((s) => s.kmTime)
    .filter((t): t is string => t != null)
    .slice(0, 3) ?? [];

  const formScore = full.combinedScore * 100;
  const valueScore = bd > 0 ? full.combinedScore / (bd / 100) : full.combinedScore * 2;
  const isSkrellCandidate =
    bd >= 2 && bd <= 14 && full.combinedScore >= 0.52 && full.formTrend !== "nedåtgående";

  return {
    number: start.number,
    name: start.horse?.name ?? `nr ${start.number}`,
    driver:
      start.driver?.shortName ??
      [start.driver?.firstName, start.driver?.lastName].filter(Boolean).join(" "),
    betDistribution: bd,
    winOdds: winOdds(start),
    winPct,
    earningsPerStart: eps,
    formScore,
    valueScore,
    horseScore: full.horseScore,
    driverScore: full.driverScore,
    combinedScore: full.combinedScore,
    formTrend: full.formTrend,
    highlights: full.highlights,
    horseChecklist: mapChecklist(full.horseItems),
    driverChecklist: mapChecklist(full.driverItems),
    isSkrellCandidate,
    recentKmTimes: recentKmTimes.length > 0 ? recentKmTimes : undefined,
  };
}

function buildTipNote(top: ScoredHorse): string {
  const parts = [
    `Modell: ${(top.combinedScore * 100).toFixed(0)}% (häst ${(top.horseScore * 100).toFixed(0)}%, kusk ${(top.driverScore * 100).toFixed(0)}%)`,
    `Form: ${top.formTrend}`,
  ];
  if ((top.valueEdgePct ?? 0) >= 5) {
    parts.push(`Undervärderad: +${top.valueEdgePct!.toFixed(1)}%-enheter mot strecken`);
  }
  if (top.highlights.length) parts.push(top.highlights.slice(0, 2).join(" · "));
  return parts.join(" · ");
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function projectedFinishLabel(rank: number, fieldSize: number): string {
  if (rank === 1) return "1:a";
  if (rank === 2) return "2:a";
  if (rank === 3) return "3:a";
  if (rank <= Math.max(3, Math.ceil(fieldSize / 3))) return "plats";
  if (rank <= Math.max(5, Math.ceil(fieldSize / 2))) return "utmanare";
  return "outsider";
}

function marketStreckLabel(marketRank: number): string | null {
  if (marketRank === 1) return "Streckfavorit";
  if (marketRank === 2) return "Tvåa på strecken";
  if (marketRank === 3) return "Trea på strecken";
  return null;
}

function modelPositionLabel(rank: number, fieldSize: number): string {
  if (rank === 1) return "Modellens förstahäst";
  if (rank <= 3) return `Modellens ${rank}:a`;
  if (rank <= Math.max(5, Math.ceil(fieldSize / 2))) return `Modell ${rank}:a — utanför topp tre`;
  return `Modell ${rank}:a — kräver gunstig loppbild`;
}

function streckShareNote(horse: ScoredHorse): string | null {
  if (horse.betDistribution <= 0) return null;
  return `${horse.betDistribution.toFixed(0)}% av strecken`;
}

function modelWinShareNote(horse: ScoredHorse): string | null {
  if (horse.estimatedWinPct == null) return null;
  return `modell ~${horse.estimatedWinPct.toFixed(0)}%`;
}

function weakChecklistLabels(horse: ScoredHorse, limit = 2): string[] {
  return [...horse.horseChecklist, ...horse.driverChecklist]
    .filter((item) => item.available && item.score < 0.42)
    .sort((a, b) => a.score - b.score)
    .map((item) => item.label.toLowerCase())
    .slice(0, limit);
}

function reasonsMarketAboveModel(horse: ScoredHorse): string[] {
  const reasons: string[] = [];
  const edge = horse.valueEdgePct ?? 0;

  if (edge <= -4) {
    reasons.push(`modellen ser lägre vinstchans (−${Math.abs(edge).toFixed(0)}%-enheter mot strecken)`);
  }
  if (horse.formTrend === "nedåtgående") reasons.push("sjunkande formkurva");
  else if (horse.formTrend === "okänd") reasons.push("oklar formbild");

  const weakLabels = weakChecklistLabels(horse);
  for (const label of weakLabels) {
    if (!reasons.some((reason) => reason.includes(label))) reasons.push(label);
  }

  if (horse.driverScore > horse.horseScore + 0.1) {
    reasons.push("strecken kan drivas av kusk snarare än hästdata");
  }

  if (reasons.length === 0 && edge < 0) {
    reasons.push("marginellt lägre kapacitet i modellen än streckbilden");
  }

  return reasons.slice(0, 3);
}

function reasonsModelAboveMarket(horse: ScoredHorse): string[] {
  const reasons: string[] = [];
  const edge = horse.valueEdgePct ?? 0;

  if (edge >= 4) {
    reasons.push(`modellen ser högre vinstchans (+${edge.toFixed(0)}%-enheter mot strecken)`);
  }
  if (horse.formTrend === "stigande" || horse.formTrend === "toppad") reasons.push("stigande formkurva");
  if (horse.isSkrellCandidate) reasons.push("spelvärde mot strecken");

  const strongLabels = [...horse.horseChecklist, ...horse.driverChecklist]
    .filter((item) => item.available && item.score >= 0.72)
    .sort((a, b) => b.score - a.score)
    .map((item) => item.label.toLowerCase())
    .slice(0, 2);
  for (const label of strongLabels) {
    if (!reasons.some((reason) => reason.includes(label))) reasons.push(label);
  }

  if (reasons.length === 0 && edge > 0) {
    reasons.push("högre samlad kapacitet i modellen än streckbilden");
  }

  return reasons.slice(0, 3);
}

function buildHorseAnalystComment(
  horse: ScoredHorse,
  rank: number,
  fieldSize: number,
): string {
  const parts: string[] = [];
  const marketRank = horse.marketRank ?? rank;
  const rankGap = rank - marketRank;
  const isMarketTop3 = marketRank <= 3;
  const streckLabel = marketStreckLabel(marketRank);
  const streckShare = streckShareNote(horse);
  const modelShare = modelWinShareNote(horse);

  if (streckLabel) {
    parts.push(streckShare ? `${streckLabel} (${streckShare})` : streckLabel);
  }

  parts.push(modelPositionLabel(rank, fieldSize));

  if (modelShare && horse.betDistribution > 0) {
    parts.push(modelShare);
  }

  if (isMarketTop3 && rankGap >= 2) {
    const reasons = reasonsMarketAboveModel(horse);
    if (reasons.length > 0) {
      parts.push(`folket högre än modellen: ${reasons.join(", ")}`);
    } else {
      parts.push("folket rankar högre — modellen ser inte lika stark ut");
    }
  } else if (isMarketTop3 && rankGap === 1) {
    const reasons = reasonsMarketAboveModel(horse);
    if (reasons.length > 0) {
      parts.push(`nära strecktoppen men modellen en placering lägre: ${reasons[0]}`);
    }
  } else if (rankGap <= -2) {
    const reasons = reasonsModelAboveMarket(horse);
    if (reasons.length > 0) {
      parts.push(`modellen högre än strecken: ${reasons.join(", ")}`);
    }
  } else if (!isMarketTop3 && rank <= 3) {
    parts.push("stark i modellen men inte bland strecktoppen");
  }

  if (horse.formTrend === "stigande" || horse.formTrend === "toppad") {
    if (!parts.some((part) => part.includes("form"))) parts.push("positiv formkurva");
  } else if (horse.formTrend === "nedåtgående" && rankGap < 2) {
    parts.push("formen viker");
  }

  const highlight = horse.highlights.find(
    (item) => !parts.some((part) => part.toLowerCase().includes(item.toLowerCase().slice(0, 12))),
  );
  if (highlight) parts.push(highlight);

  const maxParts = isMarketTop3 ? 3 : fieldSize <= 8 ? 2 : 3;
  const uniqueParts = parts.filter((part, index) => parts.indexOf(part) === index).slice(0, maxParts);
  return uniqueParts.join(" · ");
}

export function analyzeLeg(
  race: AtgRace,
  legIndex: number,
  gameType: PoolGameType,
  travsportIndex?: TravsportIndex,
  ruleId: TravRuleId = "rule6",
): LegAnalysis {
  const normalizedRuleId = normalizeTravRuleId(ruleId);
  const field = activeStarts(race);
  const rawHorses = field.map((s) => scoreStart(s, race, field, gameType, travsportIndex, normalizedRuleId));
  const totalCombined = rawHorses.reduce((sum, horse) => sum + Math.max(0.01, horse.combinedScore), 0);
  const fallbackMarketPct = rawHorses.length > 0 ? 100 / rawHorses.length : 0;
  const marketRankByNumber = new Map(
    [...rawHorses]
      .sort((a, b) => b.betDistribution - a.betDistribution || b.combinedScore - a.combinedScore)
      .map((horse, index) => [horse.number, index + 1]),
  );
  const fieldBasePct = rawHorses.length > 0 ? 100 / rawHorses.length : 10;
  const skrellEdgeThreshold = Math.max(3.0, fieldBasePct * 0.45);
  const horses = rawHorses
    .map((horse) => {
      const estimatedWinPct =
        totalCombined > 0 ? (Math.max(0.01, horse.combinedScore) / totalCombined) * 100 : fallbackMarketPct;
      const marketPct = horse.betDistribution > 0 ? horse.betDistribution : fallbackMarketPct;
      const valueEdgePct = estimatedWinPct - marketPct;
      const isSkrellCandidate =
        horse.betDistribution > 0 &&
        horse.betDistribution >= 2 &&
        horse.betDistribution <= 22 &&
        valueEdgePct >= skrellEdgeThreshold &&
        horse.combinedScore >= 0.5 &&
        horse.formTrend !== "nedåtgående";
      const highlights = [...horse.highlights];
      if (horse.betDistribution > 0 && valueEdgePct >= skrellEdgeThreshold + 0.5) {
        highlights.unshift(`Modellen högre än strecken (+${valueEdgePct.toFixed(1)}%)`);
      }
      return {
        ...horse,
        estimatedWinPct: Math.round(estimatedWinPct * 10) / 10,
        valueEdgePct: Math.round(valueEdgePct * 10) / 10,
        marketRank: marketRankByNumber.get(horse.number) ?? undefined,
        valueScore:
          marketPct > 0
            ? Math.round(((estimatedWinPct / marketPct) * 1000)) / 1000
            : horse.valueScore,
        isSkrellCandidate,
        highlights: highlights.slice(0, 5),
      };
    })
    .sort((a, b) => b.combinedScore - a.combinedScore);

  const byMarket = [...horses].sort((a, b) => b.betDistribution - a.betDistribution);
  const favorite = byMarket[0] ?? horses[0];
  const modelTop = horses[0];

  const skrellSpike =
    horses
      .filter((h) => h.isSkrellCandidate)
      .sort((a, b) => b.valueScore - a.valueScore)[0] ?? null;

  const spread = horses.length;
  const favBd = favorite?.betDistribution ?? 0;
  const secondModel = horses[1];
  const topWinPct = modelTop?.estimatedWinPct ?? 0;
  const secondWinPct = secondModel?.estimatedWinPct ?? 0;
  const modelGap = Math.max(0, topWinPct - secondWinPct);
  const valueDepth = horses.filter((horse) => (horse.valueEdgePct ?? 0) >= 3.5).length;
  const bankabilityScore = clamp01(
    topWinPct / 100 * 0.58 +
      modelGap / 100 * 1.75 +
      (modelTop.number === favorite.number ? 0.08 : 0) -
      Math.max(0, (favBd - topWinPct) / 100) * 0.22,
  );
  const opennessScore = clamp01(
    Math.max(0, 1 - bankabilityScore) * 0.58 +
      Math.max(0, 28 - favBd) / 28 * 0.18 +
      valueDepth / Math.max(1, horses.length) * 0.14 +
      Math.min(spread, 12) / 12 * 0.1,
  );

  const enrichedHorses = horses.map((horse, index) => ({
    ...horse,
    projectedRank: index + 1,
    projectedFinishLabel: projectedFinishLabel(index + 1, spread),
    confidencePct: Math.round(Math.max(horse.estimatedWinPct ?? 0, horse.combinedScore * 100) * 10) / 10,
    analystComment: buildHorseAnalystComment(horse, index + 1, spread),
  }));

  const isRule7 = normalizedRuleId === "rule7";
  const isDd = gameType === "dd";
  // DD: lägre tröskel → mer aggressiva spikar på 2-loppsfavoriter; Rule7: högre tröskel för stabilitet
  const spikThreshold = isDd ? 0.58 : isRule7 ? 0.80 : 0.72;
  const bredThreshold = isDd ? 0.50 : isRule7 ? 0.65 : 0.6;

  let recommendation: LegAnalysis["recommendation"] = "gardering";
  if (bankabilityScore >= spikThreshold) {
    recommendation = "spik";
  } else if (opennessScore >= bredThreshold) {
    recommendation = "bred";
  }

  return {
    leg: legIndex,
    raceId: race.id,
    track: race.track?.name ?? "",
    raceName: race.name,
    horses: enrichedHorses,
    favorite,
    skrellSpike,
    recommendation,
    bankabilityScore: Math.round(bankabilityScore * 100) / 100,
    opennessScore: Math.round(opennessScore * 100) / 100,
    tipNote:
      `${buildTipNote(modelTop)} · Bank ${Math.round(bankabilityScore * 100)}% · Öppenhet ${Math.round(opennessScore * 100)}%`,
    conservativeGardering: isRule7,
  };
}

export function analyzeGame(
  game: AtgGame,
  travsportIndex?: TravsportIndex,
  ruleId?: TravRuleId,
): LegAnalysis[] {
  const normalizedRuleId = normalizeTravRuleId(ruleId);
  return game.races.map((race, i) =>
    analyzeLeg(race, i + 1, game.type, travsportIndex, normalizedRuleId),
  );
}

export function pickBestSkrellLeg(legs: LegAnalysis[]): LegAnalysis | null {
  const candidates = legs.filter((l) => l.skrellSpike && l.recommendation !== "spik");
  if (candidates.length === 0) return null;
  return candidates.sort(
    (a, b) => (b.skrellSpike!.valueScore - a.skrellSpike!.valueScore),
  )[0];
}
