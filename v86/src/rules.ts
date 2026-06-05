import type { PoolGameType, TravRuleCoverageGroup, TravRuleId } from "./types";

export const DEFAULT_TRAV_RULE_ID: TravRuleId = "rule6";

export const TRAV_RULE = {
  id: "rule6" as TravRuleId,
  label: "Förbättrad plusstrategi",
  shortLabel: "Förbättrad plus",
  version: "rule6-v2",
  usesMarketData: true,
};

/** Alltid rule6 — sparas för bakåtkompatibilitet med DB-värden. */
export function normalizeTravRuleId(_ruleId?: string | null): TravRuleId {
  return "rule6";
}

export function travRulePromptScope(gameType: PoolGameType, _ruleId?: string | null): string {
  return `trav:${gameType}:rule6`;
}

export function defaultRuleCoverage(_ruleId?: TravRuleId): TravRuleCoverageGroup[] {
  return [
    {
      id: "horseCore",
      label: "Hästprofil",
      status: "available",
      detail: "Form, kapacitet, klass, bana och Travsport-historik inklusive tempo/trip och galopp.",
    },
    {
      id: "technicalCore",
      label: "Systemoptimering+",
      status: "available",
      detail: "Budget/utdelningsmål optimeras mot jämnare månadsplus utan att tappa storvinstpotential.",
    },
    {
      id: "expertConsensus",
      label: "Marknadssignal",
      status: "partial",
      detail: "Marknadsdata används men inga externa slutna expertkällor krävs.",
    },
    {
      id: "ratings",
      label: "Risk/Reward+",
      status: "available",
      detail: "Balans mellan stabil träffprofil och chans på >100k/miljonutfall. Hög galoppfara blockeras som spik.",
    },
    {
      id: "paceProfile",
      label: "Loppscenario",
      status: "available",
      detail: "Tempo/trip-proxy, spår och kusk/häst-kemi används för riskkontroll i spikval.",
    },
  ];
}
