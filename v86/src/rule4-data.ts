import type { LegAnalysis, ScoredHorse, SnapshotRaceData } from "./types";

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

function rule4Comment(
  horse: ScoredHorse,
  rank: number,
  fieldSize: number,
  topWinPct: number,
): string {
  const parts: string[] = [];
  if (rank === 1) parts.push("Djupmodellens förstahäst");
  else if (rank <= 3) parts.push(`Tidigt bud i djupmodell (${rank})`);
  else parts.push("Behöver rätt resa");

  if (horse.formTrend === "toppad" || horse.formTrend === "stigande") parts.push("stigande formkurva");
  if ((horse.tempoTripScore ?? 0.5) >= 0.68) parts.push("stark tempo/trip-match");
  if (horse.gallopRiskLevel === "låg") parts.push("stabil travprofil");
  if (horse.gallopRiskLevel === "hög") parts.push("risk för galopp");

  const winGap = Math.max(0, topWinPct - (horse.estimatedWinPct ?? 0));
  if (rank > 1 && winGap <= 5) parts.push("nära topphästen i kapacitet");
  if (horse.highlights[0]) parts.push(horse.highlights[0]);
  return parts.filter((part, index, list) => list.indexOf(part) === index).slice(0, fieldSize <= 8 ? 2 : 3).join(" · ");
}

export function applyRule4Overlay(
  legs: LegAnalysis[],
  raceData: SnapshotRaceData[],
): LegAnalysis[] {
  if (legs.length === 0 || raceData.length === 0) return legs;

  const profileByHorse = new Map<string, SnapshotRaceData["starts"][number]["travsportProfile"]>();
  for (const race of raceData) {
    for (const start of race.starts) {
      profileByHorse.set(`${race.leg}:${start.number}`, start.travsportProfile ?? null);
    }
  }

  return legs.map((leg) => {
    const adjusted = leg.horses
      .map((horse) => {
        const profile = profileByHorse.get(`${leg.leg}:${horse.number}`) ?? null;
        const startsCount = profile?.starts?.length ?? 0;
        const consistencyBoost = Math.min(0.028, startsCount * 0.002);
        const tempoBoost = Math.max(-0.02, ((horse.tempoTripScore ?? 0.5) - 0.5) * 0.08);
        const gallopAdjustment =
          horse.gallopRiskLevel === "låg" ? 0.018 : horse.gallopRiskLevel === "hög" ? -0.03 : 0;
        const formBoost = horse.formTrend === "toppad" ? 0.018 : horse.formTrend === "stigande" ? 0.01 : 0;
        const combinedScore = Math.max(
          0.01,
          Math.min(0.99, (horse.combinedScore ?? 0) + consistencyBoost + tempoBoost + gallopAdjustment + formBoost),
        );
        const highlights = [...horse.highlights];
        if (startsCount > 0) highlights.unshift(`Djupdata: ${startsCount} historiska starter`);
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
    const topWinPct = top && totalCombined > 0 ? (Math.max(0.01, top.combinedScore) / totalCombined) * 100 : 0;
    const secondWinPct =
      second && totalCombined > 0 ? (Math.max(0.01, second.combinedScore) / totalCombined) * 100 : 0;
    const modelGap = Math.max(0, topWinPct - secondWinPct);
    const contenderDepth = adjusted.filter((horse) => {
      const winPct = totalCombined > 0 ? (Math.max(0.01, horse.combinedScore) / totalCombined) * 100 : 0;
      return topWinPct - winPct <= 6;
    }).length;
    const bankabilityScore = clamp01(
      topWinPct / 100 * 0.62 +
        modelGap / 100 * 1.9 +
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
          horse.gallopRiskLevel !== "hög" &&
          totalCombined > 0 &&
          (Math.max(0.01, horse.combinedScore) / totalCombined) * 100 >= 10 &&
          topWinPct - (Math.max(0.01, horse.combinedScore) / totalCombined) * 100 <= 6.5,
      ) ?? null;

    let recommendation: LegAnalysis["recommendation"] = "gardering";
    if (bankabilityScore >= 0.72) recommendation = "spik";
    else if (opennessScore >= 0.6) recommendation = "bred";

    const horses = adjusted.map((horse, index) => {
      const estimatedWinPct = totalCombined > 0 ? (Math.max(0.01, horse.combinedScore) / totalCombined) * 100 : 0;
      return {
        ...horse,
        estimatedWinPct: Math.round(estimatedWinPct * 10) / 10,
        projectedRank: index + 1,
        projectedFinishLabel: projectedFinishLabel(index + 1, adjusted.length),
        confidencePct: Math.round(Math.max(estimatedWinPct, horse.combinedScore * 100) * 10) / 10,
        isSkrellCandidate: alternateSpike?.number === horse.number,
        analystComment: rule4Comment(horse, index + 1, adjusted.length, topWinPct),
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
      tipNote: `${horses[0]?.name ?? leg.favorite.name} toppar djup loppbild-modellen med tempo/trip- och riskfilter.`,
    };
  });
}

export function buildRule4MissingDataNotes(raceData: SnapshotRaceData[]): string[] {
  const starts = raceData.flatMap((race) => race.starts);
  const activeStarts = starts.filter((start) => !start.scratched);
  const total = activeStarts.length;
  if (total === 0) return ["Inga aktiva starter hittades för Regel 4-kontroll."];

  const withTravsport = activeStarts.filter((start) => Boolean(start.travsportProfile)).length;
  const withTempoTrip = activeStarts.filter((start) => Boolean(start.travsportProfile?.tempoTripProfile?.sampleSize)).length;
  const withGallop = activeStarts.filter((start) => Boolean(start.travsportProfile?.gallopProfile?.sampleSize)).length;
  const withRecent = activeStarts.filter((start) => (start.travsportProfile?.recentStarts?.length ?? 0) > 0).length;
  const withBestKm = activeStarts.filter((start) =>
    (start.travsportProfile?.starts ?? []).some((row) => row.kmTimeSeconds != null && !row.withdrawn),
  ).length;
  const withTripComment = activeStarts.filter((start) => Boolean(start.travsportProfile?.recentStarts?.[0]?.tripComment)).length;
  const withLiveStatus = activeStarts.filter((start) => Boolean(start.horse || start.pools)).length;

  const notes: string[] = [
    `Regel 4 datatäckning: Travsportprofil ${withTravsport}/${total}, tempo/trip ${withTempoTrip}/${total}, galopprisk ${withGallop}/${total}, senaste-start ${withRecent}/${total}, bästa-km-tid ${withBestKm}/${total}, resa-kommentar ${withTripComment}/${total}, live-status ${withLiveStatus}/${total}.`,
  ];

  if (withTravsport < total) {
    notes.push("Vissa hästar saknar Travsporthistorik och får lägre säkerhet i djup loppbild.");
  }
  if (withTempoTrip < total || withGallop < total) {
    notes.push("Tempo/trip eller galopprisk saknas för en del hästar; dessa delar körs då med neutral vikt.");
  }

  return notes;
}
