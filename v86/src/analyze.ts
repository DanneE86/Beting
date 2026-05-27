import { activeStarts, betDistribution, winOdds } from "./atg-api";
import { travRuleUsesMarketData } from "./rules";
import { scoreStartFull } from "./scoring";
import type { TravsportIndex } from "./travsport/types";
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
  travsportIndex?: TravsportIndex,
  ruleId: TravRuleId = "rule1",
): ScoredHorse {
  const bd = betDistribution(start, gameType);
  const winPct = (start.horse?.statistics?.life?.winPercentage ?? 0) / 100;
  const eps = (start.horse?.statistics?.life?.earningsPerStart ?? 0) / 100;
  const full = scoreStartFull(start, race, field, gameType, travsportIndex, ruleId);
  const usesMarket = travRuleUsesMarketData(ruleId);

  const formScore = full.combinedScore * 100;
  const valueScore = usesMarket && bd > 0 ? full.combinedScore / (bd / 100) : full.combinedScore;
  const isSkrellCandidate =
    usesMarket &&
    bd >= 2 &&
    bd <= 14 &&
    full.combinedScore >= 0.52 &&
    full.formTrend !== "nedåtgående";

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
    tempoTripScore: full.tempoTripScore,
    tempoTripStyle: full.tempoTripStyle,
    gallopRiskScore: full.gallopRiskScore,
    gallopRiskLevel: full.gallopRiskLevel,
    highlights: full.highlights,
    horseChecklist: mapChecklist(full.horseItems),
    driverChecklist: mapChecklist(full.driverItems),
    isSkrellCandidate,
  };
}

function buildTipNote(top: ScoredHorse, ruleId: TravRuleId): string {
  const parts = [
    `Modell: ${(top.combinedScore * 100).toFixed(0)}% (häst ${(top.horseScore * 100).toFixed(0)}%, kusk ${(top.driverScore * 100).toFixed(0)}%)`,
    `Form: ${top.formTrend}`,
  ];
  if (travRuleUsesMarketData(ruleId) && (top.valueEdgePct ?? 0) >= 5) {
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

function buildHorseAnalystComment(
  horse: ScoredHorse,
  rank: number,
  fieldSize: number,
  topWinPct: number,
  ruleId: TravRuleId,
): string {
  const parts: string[] = [];
  const usesMarket = travRuleUsesMarketData(ruleId);
  const marketRank = horse.marketRank ?? rank;
  const edge = horse.valueEdgePct ?? 0;

  if (rank === 1) parts.push("Modellens förstahäst");
  else if (rank <= 3) parts.push(`Tidig rank ${rank}`);
  else parts.push("Behöver klaff på vägen");

  if (usesMarket && edge >= 5) parts.push("spelvärd mot strecken");
  else if (usesMarket && edge <= -5) parts.push("överstreckad just nu");

  if (horse.formTrend === "stigande" || horse.formTrend === "toppad") parts.push("positiv formkurva");
  else if (horse.formTrend === "nedåtgående") parts.push("formfrågetecken");
  if ((horse.tempoTripScore ?? 0.5) >= 0.68) {
    parts.push(
      horse.tempoTripStyle === "front"
        ? "passande ledarprofil"
        : horse.tempoTripStyle === "closer"
          ? "tål tempo bakifrån"
          : "flexibel tripprofil",
    );
  }
  if (horse.gallopRiskLevel === "hög") parts.push("galopprisk finns");
  else if (horse.gallopRiskLevel === "låg") parts.push("travsäker profil");

  if (usesMarket) {
    if (marketRank - rank >= 2) parts.push("modellen tror mer än marknaden");
    else if (rank - marketRank >= 2) parts.push("marknaden tror mer än modellen");
  } else {
    const winGap = Math.max(0, topWinPct - (horse.estimatedWinPct ?? 0));
    if (rank > 1 && winGap <= 4.5) parts.push("nära förstahästen i modellen");
    else if (rank > 1 && winGap >= 10) parts.push("behöver tydlig förbättring");
  }

  if (horse.highlights.length > 0) {
    parts.push(horse.highlights[0]!);
  }

  const uniqueParts = parts.filter((part, index) => parts.indexOf(part) === index).slice(0, fieldSize <= 8 ? 2 : 3);
  return uniqueParts.join(" · ");
}

export function analyzeLeg(
  race: AtgRace,
  legIndex: number,
  gameType: PoolGameType,
  travsportIndex?: TravsportIndex,
  ruleId: TravRuleId = "rule1",
): LegAnalysis {
  const field = activeStarts(race);
  const rawHorses = field.map((s) => scoreStart(s, race, field, gameType, travsportIndex, ruleId));
  const totalCombined = rawHorses.reduce((sum, horse) => sum + Math.max(0.01, horse.combinedScore), 0);
  const usesMarket = travRuleUsesMarketData(ruleId);
  const fallbackMarketPct = rawHorses.length > 0 ? 100 / rawHorses.length : 0;
  const marketRankByNumber = usesMarket
    ? new Map(
        [...rawHorses]
          .sort((a, b) => b.betDistribution - a.betDistribution || b.combinedScore - a.combinedScore)
          .map((horse, index) => [horse.number, index + 1]),
      )
    : new Map<number, number>();
  const horses = rawHorses
    .map((horse) => {
      const estimatedWinPct =
        totalCombined > 0 ? (Math.max(0.01, horse.combinedScore) / totalCombined) * 100 : fallbackMarketPct;
      if (!usesMarket) {
        return {
          ...horse,
          estimatedWinPct: Math.round(estimatedWinPct * 10) / 10,
          valueEdgePct: undefined,
          marketRank: undefined,
          valueScore: Math.round((estimatedWinPct / 100) * 1000) / 1000,
          highlights: horse.highlights.slice(0, 5),
        };
      }

      const marketPct = horse.betDistribution > 0 ? horse.betDistribution : fallbackMarketPct;
      const valueEdgePct = estimatedWinPct - marketPct;
      const isSkrellCandidate =
        horse.betDistribution > 0 &&
        horse.betDistribution >= 2 &&
        horse.betDistribution <= 22 &&
        valueEdgePct >= 4.5 &&
        horse.combinedScore >= 0.5 &&
        horse.formTrend !== "nedåtgående";
      const highlights = [...horse.highlights];
      if (horse.betDistribution > 0 && valueEdgePct >= 5) {
        highlights.unshift(`Modellen högre än strecken (+${valueEdgePct.toFixed(1)}%)`);
      }
      return {
        ...horse,
        estimatedWinPct: Math.round(estimatedWinPct * 10) / 10,
        valueEdgePct: Math.round(valueEdgePct * 10) / 10,
        marketRank: marketRankByNumber.get(horse.number) ?? undefined,
        valueScore:
          marketPct > 0
            ? Math.round((estimatedWinPct / marketPct) * 1000) / 1000
            : horse.valueScore,
        isSkrellCandidate,
        highlights: highlights.slice(0, 5),
      };
    })
    .sort((a, b) => b.combinedScore - a.combinedScore);

  const modelTop = horses[0];
  const favorite = usesMarket
    ? ([...horses].sort((a, b) => b.betDistribution - a.betDistribution)[0] ?? horses[0])
    : modelTop;

  const spread = horses.length;
  const favBd = favorite?.betDistribution ?? 0;
  const secondModel = horses[1];
  const topWinPct = modelTop?.estimatedWinPct ?? 0;
  const secondWinPct = secondModel?.estimatedWinPct ?? 0;
  const modelGap = Math.max(0, topWinPct - secondWinPct);
  const valueDepth = horses.filter((horse) => (horse.valueEdgePct ?? 0) >= 3.5).length;
  const contenderDepth = horses.filter((horse) => topWinPct - (horse.estimatedWinPct ?? 0) <= 6).length;
  const bankabilityScore = clamp01(
    usesMarket
      ? topWinPct / 100 * 0.58 +
          modelGap / 100 * 1.75 +
          (modelTop.number === favorite.number ? 0.08 : 0) -
          Math.max(0, (favBd - topWinPct) / 100) * 0.22
      : topWinPct / 100 * 0.62 +
          modelGap / 100 * 1.85 +
          ((modelTop?.formTrend === "stigande" || modelTop?.formTrend === "toppad") ? 0.06 : 0) -
          Math.max(0, contenderDepth - 2) * 0.035,
  );
  const opennessScore = clamp01(
    usesMarket
      ? Math.max(0, 1 - bankabilityScore) * 0.58 +
          Math.max(0, 28 - favBd) / 28 * 0.18 +
          valueDepth / Math.max(1, horses.length) * 0.14 +
          Math.min(spread, 12) / 12 * 0.1
      : Math.max(0, 1 - bankabilityScore) * 0.62 +
          contenderDepth / Math.max(1, horses.length) * 0.22 +
          Math.min(spread, 12) / 12 * 0.16,
  );

  const alternateSpike = usesMarket
    ? horses
        .filter((horse) => horse.isSkrellCandidate)
        .sort((a, b) => b.valueScore - a.valueScore)[0] ?? null
    : horses.find(
        (horse, index) =>
          index > 0 &&
          index <= 2 &&
          horse.formTrend !== "nedåtgående" &&
          (horse.estimatedWinPct ?? 0) >= 10 &&
          topWinPct - (horse.estimatedWinPct ?? 0) <= 6.5,
      ) ?? null;

  const enrichedHorses = horses.map((horse, index) => ({
    ...horse,
    isSkrellCandidate: alternateSpike?.number === horse.number,
    projectedRank: index + 1,
    projectedFinishLabel: projectedFinishLabel(index + 1, spread),
    confidencePct: Math.round(Math.max(horse.estimatedWinPct ?? 0, horse.combinedScore * 100) * 10) / 10,
    analystComment: buildHorseAnalystComment(horse, index + 1, spread, topWinPct, ruleId),
  }));

  let recommendation: LegAnalysis["recommendation"] = "gardering";
  if (bankabilityScore >= 0.72) {
    recommendation = "spik";
  } else if (opennessScore >= 0.6) {
    recommendation = "bred";
  }

  return {
    leg: legIndex,
    raceId: race.id,
    track: race.track?.name ?? "",
    raceName: race.name,
    horses: enrichedHorses,
    favorite,
    skrellSpike: alternateSpike,
    recommendation,
    bankabilityScore: Math.round(bankabilityScore * 100) / 100,
    opennessScore: Math.round(opennessScore * 100) / 100,
    tipNote:
      `${buildTipNote(modelTop, ruleId)} · Bank ${Math.round(bankabilityScore * 100)}% · Öppenhet ${Math.round(opennessScore * 100)}%`,
  };
}

export function analyzeGame(
  game: AtgGame,
  travsportIndex?: TravsportIndex,
  ruleId: TravRuleId = "rule1",
): LegAnalysis[] {
  return game.races.map((race, i) => analyzeLeg(race, i + 1, game.type, travsportIndex, ruleId));
}

export function pickBestSkrellLeg(legs: LegAnalysis[]): LegAnalysis | null {
  const candidates = legs.filter((l) => l.skrellSpike && l.recommendation !== "spik");
  if (candidates.length === 0) return null;
  return candidates.sort(
    (a, b) => (b.skrellSpike!.valueScore - a.skrellSpike!.valueScore),
  )[0];
}
