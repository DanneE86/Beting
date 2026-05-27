import type { PoolGameType, TravRuleCoverageGroup, TravRuleId } from "./types";

export const DEFAULT_TRAV_RULE_ID: TravRuleId = "rule1";

export const TRAV_RULES: Record<
  TravRuleId,
  {
    id: TravRuleId;
    label: string;
    shortLabel: string;
    version: string;
    usesMarketData: boolean;
  }
> = {
  rule1: {
    id: "rule1",
    label: "Regel 1: ej marknad",
    shortLabel: "Ej marknad",
    version: "rule1-v1",
    usesMarketData: false,
  },
  rule2: {
    id: "rule2",
    label: "Regel 2: ordinarie regel",
    shortLabel: "Ordinarie regel",
    version: "rule2-v1",
    usesMarketData: true,
  },
  // Regel 3 och 4 är inaktiverade (döljs i UI).
  rule3: { id: "rule3", label: "Regel 3: (inaktiverad)", shortLabel: "Inaktiverad", version: "rule3-v1", usesMarketData: false },
  rule4: { id: "rule4", label: "Regel 4: (inaktiverad)", shortLabel: "Inaktiverad", version: "rule4-v1", usesMarketData: false },
};

export function normalizeTravRuleId(ruleId?: string | null): TravRuleId {
  // Endast regel 1 och 2 är aktiva.
  return ruleId === "rule2" ? "rule2" : DEFAULT_TRAV_RULE_ID;
}

export function travRuleLabel(ruleId?: string | null): string {
  return TRAV_RULES[normalizeTravRuleId(ruleId)].label;
}

export function travRuleUsesMarketData(ruleId?: string | null): boolean {
  return TRAV_RULES[normalizeTravRuleId(ruleId)].usesMarketData;
}

export function travRulePromptScope(gameType: PoolGameType, ruleId?: string | null): string {
  return `trav:${gameType}:${normalizeTravRuleId(ruleId)}`;
}

export function defaultRuleCoverage(ruleId: TravRuleId): TravRuleCoverageGroup[] {
  if (ruleId === "rule4") {
    return [
      {
        id: "horseCore",
        label: "Hästprofil & formdjup",
        status: "available",
        detail:
          "Senaste starter, formtrend, bästa km-tid med datum, starter totalt, vinstprocent och klassnivå via ATG + Travsport",
      },
      {
        id: "technicalCore",
        label: "Loppbild/teknik",
        status: "partial",
        detail:
          "Tempo/trip-profil, startsnabbhet-proxy, ledningsprofil, distans/styrka/speed finns. Proxy för resa senaste start finns. Exakt sectime/splits saknas",
      },
      {
        id: "paceProfile",
        label: "Galopp & startsätt",
        status: "partial",
        detail:
          "Galopprisk totalt och senaste trend finns, inklusive startsätts-/spårproxy. Orsaksnivå från veterinär/jobb saknas",
      },
      {
        id: "ratings",
        label: "Högsta nivå/elitkapacitet",
        status: "partial",
        detail:
          "Klass- och prestationsproxy via intjänat/start, toppresultat och tider finns. Officiella speed/power ratings saknas",
      },
      {
        id: "expertConsensus",
        label: "Hälsoläge & värmning",
        status: "missing",
        detail:
          "Veterinärstatus, behandlingar och värmningsintryck kräver externa källor/live-rapporter utanför öppna API:er",
      },
    ];
  }

  if (ruleId === "rule3") {
    return [
      { id: "horseCore", label: "Hästdata", status: "available", detail: "ATG + Travsport grunddata" },
      { id: "technicalCore", label: "Teknisk analys", status: "partial", detail: "Härledd från tider, form, spår, bana, tempo/trip och galopphistorik" },
      { id: "expertConsensus", label: "Expertkonsensus", status: "missing", detail: "Ingen expertkälla hämtad ännu" },
      { id: "ratings", label: "Ratings", status: "missing", detail: "ATG speed/power ratings saknas som strukturerade fält" },
      { id: "paceProfile", label: "Loppscenario", status: "partial", detail: "Härledd pace/trip-profil finns, men sectimes saknas fortfarande" },
    ];
  }

  return [
    { id: "horseCore", label: "Hästdata", status: "available", detail: "ATG + Travsport grunddata inklusive galopphistorik" },
    { id: "technicalCore", label: "Teknisk analys", status: "available", detail: "Modellens checklistor, formtolkning och tempo/trip-proxyer" },
    {
      id: "expertConsensus",
      label: "Expertkonsensus",
      status: ruleId === "rule2" ? "partial" : "missing",
      detail: ruleId === "rule2" ? "Ordinarie regeln väger in marknadssignaler men inte extern expertkonsensus" : "Används inte i Regel 1",
    },
    {
      id: "ratings",
      label: "Ratings",
      status: "missing",
      detail: "Strukturerade speed/power ratings saknas",
    },
    {
      id: "paceProfile",
      label: "Loppscenario",
      status: "available",
      detail: "Härleds via historiskt tempo/trip-beteende, spår och hästprofil",
    },
  ];
}
