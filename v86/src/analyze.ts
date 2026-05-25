import { activeStarts, betDistribution, winOdds } from "./atg-api";
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
): ScoredHorse {
  const bd = betDistribution(start, gameType);
  const winPct = (start.horse?.statistics?.life?.winPercentage ?? 0) / 100;
  const eps = (start.horse?.statistics?.life?.earningsPerStart ?? 0) / 100;
  const full = scoreStartFull(start, race, field, gameType, travsportIndex);

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

export function analyzeLeg(
  race: AtgRace,
  legIndex: number,
  gameType: PoolGameType,
  travsportIndex?: TravsportIndex,
): LegAnalysis {
  const field = activeStarts(race);
  const rawHorses = field.map((s) => scoreStart(s, race, field, gameType, travsportIndex));
  const totalCombined = rawHorses.reduce((sum, horse) => sum + Math.max(0.01, horse.combinedScore), 0);
  const fallbackMarketPct = rawHorses.length > 0 ? 100 / rawHorses.length : 0;
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
  const modelGap =
    modelTop && favorite ? modelTop.combinedScore - favorite.combinedScore : 0;

  let recommendation: LegAnalysis["recommendation"] = "gardering";
  if (favBd >= 42 && spread <= 10 && modelTop.number === favorite.number) {
    recommendation = "spik";
  } else if (favBd < 22 || spread >= 11 || modelGap > 0.12) {
    recommendation = "bred";
  }

  return {
    leg: legIndex,
    raceId: race.id,
    track: race.track?.name ?? "",
    raceName: race.name,
    horses,
    favorite,
    skrellSpike,
    recommendation,
    tipNote: buildTipNote(modelTop),
  };
}

export function analyzeGame(game: AtgGame, travsportIndex?: TravsportIndex): LegAnalysis[] {
  return game.races.map((race, i) => analyzeLeg(race, i + 1, game.type, travsportIndex));
}

export function pickBestSkrellLeg(legs: LegAnalysis[]): LegAnalysis | null {
  const candidates = legs.filter((l) => l.skrellSpike && l.recommendation !== "spik");
  if (candidates.length === 0) return null;
  return candidates.sort(
    (a, b) => (b.skrellSpike!.valueScore - a.skrellSpike!.valueScore),
  )[0];
}
