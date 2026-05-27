import { fetchAndelShares } from "./andelsspel";
import { defaultRuleCoverage } from "./rules";
import type {
  AndelsShareTip,
  AtgGame,
  ExpertConsensusHorse,
  ExpertSignal,
  LegAnalysis,
  TravCoverageStatus,
  TravRuleCoverageGroup,
} from "./types";

type ExpertSourceSnapshot = {
  id: string;
  name: string;
  status: TravCoverageStatus;
  signalCount: number;
  note: string;
};

export interface ExpertDataBundle {
  signals: ExpertSignal[];
  consensus: ExpertConsensusHorse[];
  coverage: TravRuleCoverageGroup[];
  missingDataNotes: string[];
  sources: ExpertSourceSnapshot[];
}

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function rankingLevelFromText(text: string): ExpertSignal["rankingLevel"] {
  const normalized = normalizeText(text);
  if (/\b(spik|bank|bästa|förstahäst|klar)\b/.test(normalized)) return "top";
  if (/\b(tidig|drag|rank|förhand|vinner)\b/.test(normalized)) return "contender";
  if (/\b(skräll|outsider|kantboll)\b/.test(normalized)) return "outsider";
  return "mention";
}

function consensusPointsFromText(text: string): number {
  const normalized = normalizeText(text);
  if (/\b(spik|bank|klar|bästa)\b/.test(normalized)) return 3;
  if (/\b(tidig|drag|rank|vinner|förstahäst)\b/.test(normalized)) return 2;
  if (/\b(skräll|outsider|kantboll)\b/.test(normalized)) return 1;
  return 0.5;
}

function extractHorseSignalsFromText(
  game: AtgGame,
  sourceId: string,
  sourceName: string,
  sourceType: ExpertSignal["sourceType"],
  sourceUrl: string | null | undefined,
  text: string,
): ExpertSignal[] {
  const normalized = normalizeText(text);
  if (!normalized) return [];

  const out: ExpertSignal[] = [];
  for (const [legIndex, race] of game.races.entries()) {
    for (const start of race.starts ?? []) {
      const horseName = start.horse?.name?.trim();
      if (!horseName) continue;
      const normalizedHorseName = normalizeText(horseName);
      const numberedPattern = new RegExp(`(?:^|\\s)${start.number}\\s+${normalizedHorseName}(?:\\s|$)`, "i");
      const shortPattern = normalizedHorseName.length >= 5 ? new RegExp(`(?:^|\\s)${normalizedHorseName}(?:\\s|$)`, "i") : null;
      if (!numberedPattern.test(normalized) && !(shortPattern && shortPattern.test(normalized))) {
        continue;
      }

      out.push({
        sourceId,
        sourceName,
        sourceType,
        sourceUrl,
        leg: legIndex + 1,
        horseNumber: start.number,
        horseName,
        rankingLevel: rankingLevelFromText(text),
        consensusPoints: consensusPointsFromText(text),
        text: text.trim().slice(0, 280),
      });
    }
  }
  return out;
}

async function fetchAtgAndelSource(game: AtgGame, existingAndelsspel?: AndelsShareTip[]): Promise<{
  source: ExpertSourceSnapshot;
  signals: ExpertSignal[];
}> {
  try {
    const shares = existingAndelsspel ?? (await fetchAndelShares(game.id, 20));
    const signals = shares.flatMap((share, index) => {
      const text = [share.name, share.description, share.marks, share.expert].filter(Boolean).join(" | ");
      return extractHorseSignalsFromText(
        game,
        `atg-andel-${index + 1}`,
        share.expert?.trim() || share.name,
        "atg-share",
        share.url,
        text,
      );
    });
    return {
      source: {
        id: "atg-andelsspel",
        name: "ATG andelsspel",
        status: shares.length > 0 ? (signals.length > 0 ? "available" : "partial") : "missing",
        signalCount: signals.length,
        note:
          signals.length > 0
            ? "Hittade strukturerbara textsignaler via andelsspel"
            : shares.length > 0
              ? "Andelsspel finns men utan tydliga häst-för-häst-signaler"
              : "Ingen andelsspeldata tillgänglig",
      },
      signals,
    };
  } catch (error) {
    return {
      source: {
        id: "atg-andelsspel",
        name: "ATG andelsspel",
        status: "missing",
        signalCount: 0,
        note: `Kunde inte hämta ATG andelsspel: ${(error as Error).message}`,
      },
      signals: [],
    };
  }
}

function placeholderSource(id: string, name: string, note: string): {
  source: ExpertSourceSnapshot;
  signals: ExpertSignal[];
} {
  return {
    source: { id, name, status: "missing", signalCount: 0, note },
    signals: [],
  };
}

function buildConsensus(signals: ExpertSignal[]): ExpertConsensusHorse[] {
  const grouped = new Map<string, ExpertConsensusHorse>();
  for (const signal of signals) {
    if (signal.leg == null || signal.horseNumber == null || !signal.horseName) continue;
    const key = `${signal.leg}:${signal.horseNumber}`;
    const existing =
      grouped.get(key) ??
      {
        leg: signal.leg,
        horseNumber: signal.horseNumber,
        horseName: signal.horseName,
        sourceCount: 0,
        consensusPoints: 0,
        sourceNames: [],
      };
    existing.sourceCount += 1;
    existing.consensusPoints += signal.consensusPoints;
    if (!existing.sourceNames.includes(signal.sourceName)) {
      existing.sourceNames.push(signal.sourceName);
    }
    grouped.set(key, existing);
  }

  return [...grouped.values()].sort(
    (a, b) => b.consensusPoints - a.consensusPoints || b.sourceCount - a.sourceCount || a.leg - b.leg,
  );
}

function mergeCoverage(
  baseCoverage: TravRuleCoverageGroup[],
  sources: ExpertSourceSnapshot[],
  consensus: ExpertConsensusHorse[],
): TravRuleCoverageGroup[] {
  return baseCoverage.map((group) => {
    if (group.id === "expertConsensus") {
      const availableSources = sources.filter((source) => source.signalCount > 0).length;
      return {
        ...group,
        status: consensus.length > 0 ? "available" : availableSources > 0 ? "partial" : "missing",
        sourceCount: availableSources,
        detail:
          consensus.length > 0
            ? `${consensus.length} hästsignaler med strukturerad konsensus`
            : sources.length > 0
              ? "Källor avlästa men utan tillräckligt tydlig hästmatchning"
              : group.detail,
      };
    }
    return group;
  });
}

export async function fetchExpertDataBundle(
  game: AtgGame,
  existingAndelsspel?: AndelsShareTip[],
): Promise<ExpertDataBundle> {
  const baseCoverage = defaultRuleCoverage("rule3");
  const sourceResults = await Promise.all([
    fetchAtgAndelSource(game, existingAndelsspel),
    Promise.resolve(
      placeholderSource(
        "expressen",
        "Expressen Trav",
        "Ingen stabil öppen parser ännu för den här källan",
      ),
    ),
    Promise.resolve(
      placeholderSource(
        "aftonbladet",
        "Aftonbladet Trav",
        "Ingen stabil öppen parser ännu för den här källan",
      ),
    ),
    Promise.resolve(
      placeholderSource(
        "open-alternatives",
        "Öppna travkällor",
        "Källager på plats men fler parserkopplingar återstår",
      ),
    ),
  ]);

  const signals = sourceResults.flatMap((result) => result.signals);
  const consensus = buildConsensus(signals);
  const sources = sourceResults.map((result) => result.source);
  const coverage = mergeCoverage(baseCoverage, sources, consensus);
  const missingDataNotes = sources
    .filter((source) => source.status !== "available")
    .map((source) => `${source.name}: ${source.note}`);

  return { signals, consensus, coverage, missingDataNotes, sources };
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

function commentForRule3Horse(
  horse: LegAnalysis["horses"][number],
  rank: number,
  fieldSize: number,
  topWinPct: number,
  consensusPoints: number,
): string {
  const parts: string[] = [];
  if (rank === 1) parts.push("Expertmotorns förstahäst");
  else if (rank <= 3) parts.push(`Tidig expert-rank ${rank}`);
  else parts.push("Behöver rätt loppbild");
  if (horse.formTrend === "stigande" || horse.formTrend === "toppad") parts.push("positiv trend");
  if (consensusPoints > 0) parts.push(`expertstöd ${consensusPoints.toFixed(1)}p`);
  const winGap = Math.max(0, topWinPct - (horse.estimatedWinPct ?? 0));
  if (rank > 1 && winGap <= 4.5) parts.push("nära topp i modellen");
  else if (rank > 1 && winGap >= 10) parts.push("kräver tydlig höjning");
  if (horse.highlights[0]) parts.push(horse.highlights[0]);
  return parts.filter((part, index, list) => list.indexOf(part) === index).slice(0, fieldSize <= 8 ? 2 : 3).join(" · ");
}

export function applyRule3Overlay(
  legs: LegAnalysis[],
  consensus: ExpertConsensusHorse[],
): LegAnalysis[] {
  if (consensus.length === 0) return legs;

  const consensusMap = new Map<string, ExpertConsensusHorse>();
  for (const item of consensus) {
    consensusMap.set(`${item.leg}:${item.horseNumber}`, item);
  }

  return legs.map((leg) => {
    const adjusted = leg.horses
      .map((horse) => {
        const consensusEntry = consensusMap.get(`${leg.leg}:${horse.number}`);
        const consensusBoost = Math.min(0.05, (consensusEntry?.consensusPoints ?? 0) * 0.012);
        const technicalBoost =
          (horse.formTrend === "toppad" ? 0.018 : horse.formTrend === "stigande" ? 0.01 : 0) +
          Math.max(0, (horse.horseScore ?? 0) - (horse.driverScore ?? 0)) * 0.03;
        const combinedScore = Math.min(0.99, (horse.combinedScore ?? 0) + consensusBoost + technicalBoost);
        const highlights = [...horse.highlights];
        if (consensusEntry && consensusEntry.consensusPoints > 0) {
          highlights.unshift(
            `Expertstöd ${consensusEntry.consensusPoints.toFixed(1)}p från ${consensusEntry.sourceCount} källor`,
          );
        }
        return {
          ...horse,
          combinedScore,
          highlights: highlights.slice(0, 5),
        };
      })
      .sort((a, b) => b.combinedScore - a.combinedScore);

    const totalCombined = adjusted.reduce((sum, horse) => sum + Math.max(0.01, horse.combinedScore ?? 0), 0);
    const top = adjusted[0];
    const second = adjusted[1];
    const topWinPct =
      top && totalCombined > 0 ? (Math.max(0.01, top.combinedScore ?? 0) / totalCombined) * 100 : 0;
    const secondWinPct =
      second && totalCombined > 0 ? (Math.max(0.01, second.combinedScore ?? 0) / totalCombined) * 100 : 0;
    const modelGap = Math.max(0, topWinPct - secondWinPct);
    const contenderDepth = adjusted.filter((horse) => {
      const winPct =
        totalCombined > 0 ? (Math.max(0.01, horse.combinedScore ?? 0) / totalCombined) * 100 : 0;
      return topWinPct - winPct <= 6;
    }).length;
    const bankabilityScore = clamp01(
      topWinPct / 100 * 0.62 +
        modelGap / 100 * 1.85 +
        ((top?.formTrend === "stigande" || top?.formTrend === "toppad") ? 0.06 : 0) -
        Math.max(0, contenderDepth - 2) * 0.035,
    );
    const opennessScore = clamp01(
      Math.max(0, 1 - bankabilityScore) * 0.62 +
        contenderDepth / Math.max(1, adjusted.length) * 0.22 +
        Math.min(adjusted.length, 12) / 12 * 0.16,
    );
    const alternateSpike =
      adjusted.find(
        (horse, index) =>
          index > 0 &&
          index <= 2 &&
          horse.formTrend !== "nedåtgående" &&
          totalCombined > 0 &&
          (Math.max(0.01, horse.combinedScore ?? 0) / totalCombined) * 100 >= 10 &&
          topWinPct - (Math.max(0.01, horse.combinedScore ?? 0) / totalCombined) * 100 <= 6.5,
      ) ?? null;

    let recommendation: LegAnalysis["recommendation"] = "gardering";
    if (bankabilityScore >= 0.72) recommendation = "spik";
    else if (opennessScore >= 0.6) recommendation = "bred";

    const horses = adjusted.map((horse, index) => {
      const estimatedWinPct =
        totalCombined > 0 ? (Math.max(0.01, horse.combinedScore ?? 0) / totalCombined) * 100 : 0;
      const consensusEntry = consensusMap.get(`${leg.leg}:${horse.number}`);
      return {
        ...horse,
        estimatedWinPct: Math.round(estimatedWinPct * 10) / 10,
        projectedRank: index + 1,
        projectedFinishLabel: projectedFinishLabel(index + 1, adjusted.length),
        confidencePct: Math.round(Math.max(estimatedWinPct, (horse.combinedScore ?? 0) * 100) * 10) / 10,
        isSkrellCandidate: alternateSpike?.number === horse.number,
        analystComment: commentForRule3Horse(
          horse,
          index + 1,
          adjusted.length,
          topWinPct,
          consensusEntry?.consensusPoints ?? 0,
        ),
      };
    });

    return {
      ...leg,
      horses,
      favorite: horses[0] ?? leg.favorite,
      skrellSpike: alternateSpike ? horses.find((horse) => horse.number === alternateSpike.number) ?? alternateSpike : null,
      recommendation,
      bankabilityScore: Math.round(bankabilityScore * 100) / 100,
      opennessScore: Math.round(opennessScore * 100) / 100,
      tipNote: `${horses[0]?.name ?? leg.favorite.name} toppar expertmotorn${consensus.some((item) => item.leg === leg.leg) ? " med expertstöd" : ""}.`,
    };
  });
}
