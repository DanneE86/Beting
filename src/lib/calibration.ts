import type { LeagueCalibration } from "./learning.server";
import type { CalibrationAdjustments } from "./poisson-model";

/** Mappar server-kalibrering → poisson-modellens justeringsinput. */
export function calibrationToAdjustments(
  cal: LeagueCalibration | null | undefined,
): CalibrationAdjustments | null {
  if (!cal) return null;
  return {
    historicalBaseline: cal.historicalBaseline
      ? {
          homePct: cal.historicalBaseline.homePct,
          drawPct: cal.historicalBaseline.drawPct,
          awayPct: cal.historicalBaseline.awayPct,
          matches: cal.historicalBaseline.matches,
        }
      : null,
    predictedBias: cal.predictedBias,
    actualDistribution: cal.actualDistribution,
    resolved: cal.resolved,
    avgBrier: cal.avgBrier,
    byConfidence: cal.byConfidence,
  };
}
