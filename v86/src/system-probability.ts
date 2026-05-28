import type { BuiltSystem, LegAnalysis, SystemHitOutlook, SystemSelection } from "./types";

export type { SystemHitOutlook } from "./types";

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

export function selectedHitProbability(leg: LegAnalysis, picks: number[]): number {
  const prob = picks.reduce((sum, pick) => sum + estimatedHorseWinShare(leg, pick), 0);
  return Math.min(0.985, Math.max(0.02, prob));
}

function describeLegRisk(
  leg: LegAnalysis,
  selection: SystemSelection,
  hitPct: number,
): string {
  const hitLabel = `${(hitPct * 100).toFixed(0)}%`;
  const picks = selection.picks;

  if (selection.type === "skrell-spik") {
    const horse = leg.horses.find((item) => item.number === picks[0]);
    const name = horse?.name ?? `nr ${picks[0]}`;
    return `Skräll-spik på ${name} – modellen ger bara ~${hitLabel} chans att avdelningen träffas`;
  }

  if (picks.length === 1) {
    const horse = leg.horses.find((item) => item.number === picks[0]);
    const modelWin = horse?.estimatedWinPct;
    const name = horse?.name ?? `nr ${picks[0]}`;
    if ((leg.opennessScore ?? 0) >= 0.58) {
      return `Öppet lopp (avd ${leg.leg}) – spik ${name} trots låg bankbarhet, ~${hitLabel} träff`;
    }
    if (modelWin != null && modelWin < 24) {
      return `Spik ${name} – modellen ser bara ~${modelWin.toFixed(0)}% vinstchans`;
    }
    return `Enkel spik ${name} – allt hänger på ett nummer (~${hitLabel})`;
  }

  if (picks.length >= 4) {
    return `Bred gardering (${picks.length} hästar) men sammanlagt bara ~${hitLabel} att någon markerad vinner`;
  }

  if ((leg.bankabilityScore ?? 0) < 0.45) {
    return `Svag bankbarhet i avd ${leg.leg} – gardering täcker bara ~${hitLabel}`;
  }

  return `Gardering med ${picks.length} hästar – lägst träffsäkerhet i systemet (~${hitLabel})`;
}

/** Beräknar träffsannolikhet per avdelning och hela raden utifrån systemets markeringar. */
export function computeSystemHitOutlook(
  legs: LegAnalysis[],
  system: BuiltSystem,
): SystemHitOutlook {
  const legOutlooks: SystemHitOutlook["legs"] = system.selections.map((selection) => {
    const leg = legs.find((item) => item.leg === selection.leg);
    const hitPct = leg ? selectedHitProbability(leg, selection.picks) : 0.02;
    return {
      leg: selection.leg,
      hitPct,
      picks: selection.picks,
      selectionType: selection.type,
    };
  });

  const fullRowHitPct =
    legOutlooks.length > 0
      ? legOutlooks.reduce((product, leg) => product * leg.hitPct, 1)
      : 0;

  const weakest = legOutlooks.reduce(
    (min, leg) => (leg.hitPct < min.hitPct ? leg : min),
    legOutlooks[0] ?? { leg: 1, hitPct: 1, picks: [], selectionType: "gardering" as const },
  );

  const weakestSelection = system.selections.find((item) => item.leg === weakest.leg);
  const weakestLeg = legs.find((item) => item.leg === weakest.leg);

  const reason =
    weakestSelection && weakestLeg
      ? describeLegRisk(weakestLeg, weakestSelection, weakest.hitPct)
      : "Ingen markering att bedöma";

  return {
    fullRowHitPct,
    legs: legOutlooks,
    biggestRisk: {
      leg: weakest.leg,
      hitPct: weakest.hitPct,
      reason,
    },
  };
}

export function formatHitPct(fraction: number, digits = 1): string {
  return `${(fraction * 100).toFixed(digits)}%`;
}
