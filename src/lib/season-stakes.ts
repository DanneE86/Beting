/** Säsongsinsatser per lag — används i slutet av tracking-säsongen. */
export type SeasonStakes =
  | "guld"
  | "topp-strid"
  | "cl-säkrad"
  | "europa-säkrad"
  | "europaplats"
  | "europa-kamp"
  | "kvalplats"
  | "nedflyttning"
  | "nedflyttningskamp"
  | "inget-att-spela-for";

export type LeagueEndCfg = {
  /** Antal CL-platser (t.ex. 4 i PL). */
  cl: number;
  /** Sista plats som ger Europa League (t.ex. 5). */
  europa: number;
  /** Sista plats för Conference League om tillämpligt. */
  conference?: number;
  releg: number;
  playoff?: boolean;
};

/** Liga-specifik tabellkonfiguration — CL / Europa / nedflyttning. */
export const LEAGUE_END_CFG: Record<string, LeagueEndCfg> = {
  "eng.1": { cl: 4, europa: 5, conference: 6, releg: 3 },
  "esp.1": { cl: 4, europa: 5, conference: 6, releg: 3 },
  "ger.1": { cl: 4, europa: 5, conference: 6, releg: 2, playoff: true },
  "ita.1": { cl: 4, europa: 5, conference: 6, releg: 3 },
  "fra.1": { cl: 3, europa: 4, conference: 5, releg: 3 },
  "ned.1": { cl: 2, europa: 3, conference: 4, releg: 3 },
  "por.1": { cl: 2, europa: 3, releg: 2 },
  "bel.1": { cl: 1, europa: 2, releg: 2 },
  "tur.1": { cl: 2, europa: 3, releg: 3 },
  "sco.1": { cl: 2, europa: 3, releg: 2 },
  "swe.1": { cl: 1, europa: 3, releg: 2 },
  "nor.1": { cl: 1, europa: 3, releg: 2 },
  "den.1": { cl: 1, europa: 3, releg: 2 },
};

export const DEFAULT_CFG: LeagueEndCfg = { cl: 4, europa: 5, releg: 3 };

/** Poäng som motståndare maximalt kan ta i kvarvarande omgångar. */
export function maxCatchablePts(remaining: number): number {
  return Math.max(0, remaining) * 3;
}

/** Lag inom CL-zonen kan inte tappa platsen om poängförsprånget är större än detta. */
export function isObjectiveSecured(
  ourPts: number,
  chaserPts: number,
  remaining: number,
): boolean {
  const maxCatch = maxCatchablePts(remaining);
  return ourPts - chaserPts > maxCatch;
}

/** Motivation 0–10 — högre = mer att spela för. */
export function motivationWeight(stake: SeasonStakes): number {
  switch (stake) {
    case "guld":
      return 10;
    case "topp-strid":
      return 9;
    case "nedflyttning":
      return 9;
    case "europa-kamp":
      return 8;
    case "nedflyttningskamp":
      return 8;
    case "europaplats":
      return 6;
    case "kvalplats":
      return 7;
    case "cl-säkrad":
    case "europa-säkrad":
    case "inget-att-spela-for":
      return 0;
    default:
      return 3;
  }
}

export function stakeLabelSv(stake: SeasonStakes): string {
  switch (stake) {
    case "guld":
      return "guldstrid";
    case "topp-strid":
      return "CL-strid";
    case "cl-säkrad":
      return "CL redan säkrad";
    case "europa-säkrad":
      return "Europaplats säkrad";
    case "europaplats":
      return "Europaplats";
    case "europa-kamp":
      return "jagar Europaplats";
    case "kvalplats":
      return "kvalplats";
    case "nedflyttning":
      return "nedflyttningsstrid";
    case "nedflyttningskamp":
      return "jagar säker plats";
    case "inget-att-spela-for":
      return "inget att spela för";
    default:
      return stake;
  }
}

type StandingSlice = { rank: number; pts: number };

/**
 * Beräknar vad ett lag har att spela för baserat på tabellläge och kvarvarande omgångar.
 */
export function stakeForTeam(
  team: StandingSlice,
  sorted: StandingSlice[],
  cfg: LeagueEndCfg,
  remaining: number,
): SeasonStakes {
  const { rank, pts } = team;
  const total = sorted.length;
  const maxLeft = maxCatchablePts(remaining);
  const relegLine = total - cfg.releg;

  // Guld
  if (rank === 1) {
    const second = sorted[1];
    if (second && second.pts - pts <= maxLeft) return "guld";
    if (remaining <= 2) return "guld";
  }
  if (rank === 2) {
    const first = sorted[0];
    if (first && first.pts - pts <= maxLeft) return "guld";
  }

  // CL-zon
  if (rank <= cfg.cl) {
    const firstOutsideCl = sorted[cfg.cl];
    if (firstOutsideCl && !isObjectiveSecured(pts, firstOutsideCl.pts, remaining)) {
      return rank <= 2 ? "topp-strid" : "topp-strid";
    }
    return "cl-säkrad";
  }

  // Europa League-plats (inom zon men utanför CL)
  if (rank <= cfg.europa) {
    const firstOutsideEuropa = sorted[cfg.europa];
    if (firstOutsideEuropa && !isObjectiveSecured(pts, firstOutsideEuropa.pts, remaining)) {
      return "europaplats";
    }
    // Säkrad Europa men kan fortfarande jaga CL
    const clLine = sorted[cfg.cl - 1];
    if (clLine && clLine.pts - pts <= maxLeft) return "topp-strid";
    return "europa-säkrad";
  }

  // Conference / sista europaplats
  const conferenceLine = cfg.conference ?? cfg.europa;
  if (rank <= conferenceLine + 2) {
    const holder = sorted[conferenceLine - 1];
    if (holder && holder.pts - pts <= maxLeft) return "europa-kamp";
    const nextAbove = sorted[rank - 2];
    if (nextAbove && nextAbove.pts - pts <= maxLeft && rank === conferenceLine + 1) {
      return "europa-kamp";
    }
  }

  // Nedflyttning — redan i botten
  if (rank > relegLine) return "nedflyttning";
  if (cfg.playoff && rank === relegLine) return "kvalplats";

  // Kan åka ner?
  const firstSafe = sorted[total - cfg.releg - 1];
  if (
    firstSafe &&
    pts - firstSafe.pts <= maxLeft &&
    rank >= total - cfg.releg - 3
  ) {
    return cfg.playoff && rank >= relegLine - 1 ? "kvalplats" : "nedflyttningskamp";
  }

  return "inget-att-spela-for";
}

export function resolveMotivationAsymmetry(
  homeStake: SeasonStakes,
  awayStake: SeasonStakes,
): { asymmetry: boolean; motivatedSide: "home" | "away" | null; homeMot: number; awayMot: number } {
  const homeMot = motivationWeight(homeStake);
  const awayMot = motivationWeight(awayStake);
  const diff = homeMot - awayMot;
  if (Math.abs(diff) < 4) {
    return { asymmetry: false, motivatedSide: null, homeMot, awayMot };
  }
  return {
    asymmetry: true,
    motivatedSide: diff > 0 ? "home" : "away",
    homeMot,
    awayMot,
  };
}
