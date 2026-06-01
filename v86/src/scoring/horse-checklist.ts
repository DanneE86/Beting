import type { AtgRace, AtgStart } from "../types";
import type { TravsportHorseProfile } from "../travsport/types";
import type { ChecklistItem, HorseDriverScores } from "./types";
import { distanceBand, pctFromAtg, recordToSeconds } from "./utils";

type YearStat = {
  starts?: number;
  placement?: { "1"?: number; "2"?: number; "3"?: number };
  records?: { place?: number; startMethod?: string; distance?: string; time?: { minutes?: number; seconds?: number; tenths?: number } }[];
  winPercentage?: number;
};

function recentPlaces(y2025?: YearStat, y2026?: YearStat): number[] {
  const places: number[] = [];
  for (const y of [y2025, y2026]) {
    for (const r of y?.records ?? []) {
      if (r.place != null && r.place > 0) places.push(r.place);
    }
  }
  return places.slice(-6);
}

function formTrendFromPlaces(places: number[]): HorseDriverScores["formTrend"] {
  if (places.length < 3) return "okänd";
  const recent = places.slice(-3);
  const older = places.slice(-6, -3);
  const avg = (arr: number[]) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);
  const r = avg(recent);
  const o = avg(older);
  if (r < o - 0.8) return "stigande";
  if (r > o + 0.8) return "nedåtgående";
  if (recent.every((p) => p <= 3)) return "toppad";
  return "okänd";
}

function trendScore(trend: HorseDriverScores["formTrend"]): number {
  switch (trend) {
    case "stigande":
      return 0.85;
    case "toppad":
      return 0.75;
    case "nedåtgående":
      return 0.35;
    default:
      return 0.5;
  }
}

function restScoreFromDays(days: number | null): number {
  if (days == null) return 0.5;
  if (days >= 10 && days <= 35) return 0.85;
  if (days >= 7 && days < 10) return 0.7;
  if (days > 45) return 0.45;
  if (days < 7) return 0.55;
  return 0.6;
}

function normalizeStartMethod(method?: string): "auto" | "volte" | "okänd" {
  const m = `${method ?? ""}`.toLowerCase();
  if (m.includes("volt")) return "volte";
  if (m.includes("auto") || m === "a") return "auto";
  return "okänd";
}

function laneBucket(post: number, method: "auto" | "volte" | "okänd"): "inner" | "middle" | "outer" | "back" {
  if (method === "volte") {
    if (post <= 3) return "inner";
    if (post <= 6) return "middle";
    if (post <= 9) return "outer";
    return "back";
  }
  if (post <= 3) return "inner";
  if (post <= 6) return "middle";
  if (post <= 8) return "outer";
  return "back";
}

function scoreFromPlacings(placings: number[]): number {
  if (!placings.length) return 0.5;
  const wins = placings.filter((p) => p === 1).length;
  const top3 = placings.filter((p) => p <= 3).length;
  const avgPlacement = placings.reduce((sum, p) => sum + p, 0) / placings.length;
  const placementScore = Math.max(0.15, Math.min(1, 1 - (avgPlacement - 1) / 8));
  return Math.max(
    0.2,
    Math.min(0.95, 0.2 + (wins / placings.length) * 0.35 + (top3 / placings.length) * 0.2 + placementScore * 0.25),
  );
}

function buildLaneHistory(
  travsport: TravsportHorseProfile | null | undefined,
  post: number,
  raceMethod: "auto" | "volte" | "okänd",
) {
  if (!travsport?.starts?.length || raceMethod === "okänd") return null;
  const completed = travsport.starts.filter(
    (row) =>
      row.placement != null &&
      row.placement > 0 &&
      row.startPosition != null &&
      normalizeStartMethod(row.startMethod) === raceMethod,
  );
  if (!completed.length) return null;

  const exact = completed.filter((row) => row.startPosition === post);
  const bucket = laneBucket(post, raceMethod);
  const bucketRows = completed.filter((row) => laneBucket(row.startPosition!, raceMethod) === bucket);
  const basis = exact.length >= 2 ? exact : bucketRows.length >= 3 ? bucketRows : [];
  if (!basis.length) return null;

  const placings = basis.map((row) => row.placement!);
  const wins = placings.filter((p) => p === 1).length;
  const top3 = placings.filter((p) => p <= 3).length;
  const score = scoreFromPlacings(placings);
  const mode = exact.length >= 2 ? "samma spår" : "liknande spår";
  const label =
    bucket === "inner" ? "innerspår" : bucket === "middle" ? "mellanspår" : bucket === "outer" ? "yttre spår" : "bakspår";

  return {
    exactStarts: exact.length,
    bucketStarts: bucketRows.length,
    score,
    strong: score >= 0.72,
    weak: score <= 0.45,
    note:
      mode === "samma spår"
        ? `${mode}: ${wins}/${basis.length} segrar, topp-3 ${top3}/${basis.length} (${raceMethod})`
        : `${mode} (${label}): ${wins}/${basis.length} segrar, topp-3 ${top3}/${basis.length} (${raceMethod})`,
  };
}

export function scoreHorseChecklist(
  start: AtgStart,
  race: AtgRace,
  fieldStarts: AtgStart[],
  travsport?: TravsportHorseProfile | null,
): {
  items: ChecklistItem[];
  formTrend: HorseDriverScores["formTrend"];
  highlights: string[];
  tempoTripScore?: number;
  tempoTripStyle?: "front" | "closer" | "versatile" | "okänd";
  gallopRiskScore?: number;
  gallopRiskLevel?: "låg" | "medel" | "hög";
} {
  const h = start.horse;
  const stats = h?.statistics;
  const y2025 = stats?.years?.["2025"] as YearStat | undefined;
  const y2026 = stats?.years?.["2026"] as YearStat | undefined;
  const life = stats?.life as YearStat & { winPercentage?: number; earningsPerStart?: number } | undefined;
  const places = recentPlaces(y2025, y2026);
  const tsPlaces = travsport?.recentStarts?.map((s) => s.placement).filter((p): p is number => p != null) ?? [];
  const formTrend = travsport?.formTrend ?? formTrendFromPlaces(tsPlaces.length >= 3 ? tsPlaces : places);
  const highlights: string[] = [];

  const recentPlaceScore =
    tsPlaces.length > 0
      ? tsPlaces.reduce((s, p) => s + Math.max(0, 1 - (p - 1) / 8), 0) / tsPlaces.length
      : places.length > 0
        ? places.reduce((s, p) => s + Math.max(0, 1 - (p - 1) / 8), 0) / places.length
        : 0.5;

  const raceDist = race.distance ?? start.distance;
  const band = distanceBand(raceDist);
  const horseBand = h?.record?.distance ?? life?.records?.[0]?.distance;
  const distMatch =
    horseBand === band ||
    (horseBand === "short" && band === "short") ||
    (horseBand === "medium" && band !== "long") ||
    (horseBand === "long" && band === "long");
  const distScore = distMatch ? 0.8 : horseBand ? 0.45 : 0.5;

  const raceMethod = (race as { startMethod?: string }).startMethod ?? "auto";
  const horseMethod = h?.record?.startMethod ?? "auto";
  const methodScore = raceMethod === horseMethod ? 0.85 : 0.4;

  const post = start.postPosition ?? start.number;
  const normalizedRaceMethod = normalizeStartMethod(raceMethod);
  const isVolt = normalizedRaceMethod === "volte";
  const baseLaneScore = isVolt
    ? post <= 4
      ? 0.7
      : 0.55
    : post <= 3
      ? 0.75
      : post >= 8
        ? 0.45
        : 0.6;
  const laneHistory = buildLaneHistory(travsport, post, normalizedRaceMethod);
  let laneScore = (baseLaneScore + methodScore) / 2;
  if (laneHistory) {
    const historyWeight = laneHistory.exactStarts >= 2 ? 0.6 : 0.45;
    laneScore = laneScore * (1 - historyWeight) + laneHistory.score * historyWeight;
  }

  const trackName = race.track?.name ?? "";
  const homeTrack = h?.homeTrack?.name ?? "";
  let trackScore = homeTrack && trackName && homeTrack.toLowerCase().includes(trackName.slice(0, 4).toLowerCase())
    ? 0.85
    : homeTrack
      ? 0.55
      : 0.5;
  if (travsport && travsport.trackStarts > 0) {
    const tr = travsport.trackWins / travsport.trackStarts;
    trackScore = Math.min(1, 0.45 + tr * 1.8);
  }

  const condition = (race.track as { condition?: string })?.condition;
  const surfaceScore = condition ? (condition === "light" ? 0.6 : 0.55) : 0.5;

  const eps = life?.earningsPerStart ?? 0;
  const fieldEps = fieldStarts
    .map((s) => s.horse?.statistics?.life?.earningsPerStart ?? 0)
    .filter((x) => x > 0);
  const medianEps =
    fieldEps.length > 0
      ? [...fieldEps].sort((a, b) => a - b)[Math.floor(fieldEps.length / 2)]
      : eps;
  const classScore =
    eps > 0 && medianEps > 0 ? Math.min(1, Math.max(0.2, (eps / medianEps) ** 0.65)) : 0.5;

  const trainer = h?.trainer;
  const trWin = pctFromAtg(trainer?.statistics?.years?.["2026"]?.winPercentage);
  const trainerScore = Math.min(1, trWin / 18);

  const shoes = h?.shoes;
  const equipChanged =
    shoes?.front?.changed || shoes?.back?.changed || h?.sulky?.type?.changed || h?.sulky?.colour?.changed;
  const equipScore = equipChanged ? 0.55 : 0.65;

  const age = h?.age ?? 5;
  // Travhästar toppar fysiskt vid 4–5 år, sedan gradvis avtagande.
  const ageScore =
    age <= 2 ? 0.38 :
    age === 3 ? 0.58 :
    age === 4 ? 0.84 :
    age === 5 ? 0.90 :
    age === 6 ? 0.77 :
    age === 7 ? 0.64 :
    age === 8 ? 0.53 :
    age === 9 ? 0.45 :
    Math.max(0.32, 0.45 - (age - 9) * 0.04);
  const ageLabel =
    age <= 2 ? "under primålder" :
    age === 3 ? "ung, första säsongerna" :
    age === 4 ? "på väg mot toppform" :
    age === 5 ? "primålder" :
    age === 6 ? "fortfarande konkurrenskraftig" :
    age === 7 ? "avtar gradvis" :
    age === 8 ? "tydlig avmattning" :
    age === 9 ? "veteran" :
    "sen karriär, tydlig avmattning";

  const recentKmTimes = travsport?.recentStarts
    ?.map((s) => s.kmTimeSeconds)
    .filter((t): t is number => t != null)
    .slice(0, 3) ?? [];
  const usingRecentTimes = recentKmTimes.length >= 2;
  const recentAvgTime = usingRecentTimes
    ? recentKmTimes.reduce((a, b) => a + b, 0) / recentKmTimes.length
    : null;
  const recordTime = recordToSeconds(h?.record?.time);
  const myTime = recentAvgTime ?? recordTime;
  const fieldTimes = fieldStarts
    .map((s) => recordToSeconds(s.horse?.record?.time))
    .filter((t): t is number => t != null);
  const bestTime = fieldTimes.length ? Math.min(...fieldTimes) : null;
  const speedScore =
    myTime != null && bestTime != null
      ? Math.min(1, Math.max(0.2, 1 - (myTime - bestTime) / 4))
      : 0.5;

  const starts2026 = y2026?.starts ?? 0;
  const restScore = travsport?.daysSinceLastStart != null
    ? restScoreFromDays(travsport.daysSinceLastStart)
    : starts2026 <= 3
      ? 0.65
      : starts2026 >= 12
        ? 0.5
        : 0.6;

  if (age === 4 || age === 5) highlights.push(`Primålder (${age} år) — toppar fysiskt`);
  else if (age >= 9) highlights.push(`Veteran (${age} år) — avtagande kapacitet`);

  if (travsport?.recentStarts?.length) {
    const km = travsport.recentStarts
      .map((s) => s.kmTime)
      .filter(Boolean)
      .slice(0, 3)
      .join(", ");
    if (km) highlights.push(`Travsport: ${km}`);
  }
  if (travsport && travsport.trackStarts >= 3 && travsport.trackWins >= 1) {
    highlights.push(`Bana ${travsport.trackWins}/${travsport.trackStarts} segrar`);
  }
  if (laneHistory?.strong) highlights.push(`Spårhistorik stark (${laneHistory.note})`);
  if (laneHistory?.weak) highlights.push(`Spårhistorik svag (${laneHistory.note})`);
  if (formTrend === "stigande") highlights.push("Stigande formkurva");
  if (distMatch) highlights.push("Distans passar");
  if (trWin >= 15) highlights.push(`Tränare i form (${trWin.toFixed(0)}% vinst 2026)`);
  if (equipChanged) highlights.push("Utrustning ändrad");
  if (myTime != null && bestTime != null && myTime <= bestTime + 0.3)
    highlights.push("Snabb km-tid i fältet");

  const items: ChecklistItem[] = [
    {
      id: "recent_starts",
      category: "häst",
      label: "Senaste 5–6 starter (Travsport)",
      score: recentPlaceScore,
      weight: 1.3,
      available: tsPlaces.length > 0 || places.length > 0,
      note: tsPlaces.length
        ? travsport!.recentStarts
            .slice(0, 6)
            .map((s) => `${s.placement ?? "?"}@${s.kmTime ?? "-"}`)
            .join(" · ")
        : places.length
          ? `ATG: ${places.join("-")}`
          : "Saknas",
    },
    {
      id: "form_curve",
      category: "häst",
      label: "Formkurva",
      score: trendScore(formTrend),
      weight: 1,
      available: tsPlaces.length >= 3 || places.length >= 3,
      note: travsport ? `Travsport: ${formTrend}` : formTrend,
    },
    {
      id: "distance",
      category: "häst",
      label: "Distansanpassning",
      score: distScore,
      weight: 1.1,
      available: !!raceDist,
      note: `${raceDist ?? "?"} m (${band}), häst: ${horseBand ?? "?"}`,
    },
    {
      id: "lane_start",
      category: "häst",
      label: "Spår & starttyp",
      score: laneScore,
      weight: 0.9,
      available: true,
      note: `Spår ${post}, ${raceMethod}${isVolt ? " (volt)" : " (auto)"}${laneHistory ? ` · ${laneHistory.note}` : ""}`,
    },
    {
      id: "track",
      category: "häst",
      label: "Bana (historik)",
      score: trackScore,
      weight: 0.9,
      available: !!trackName,
      note: travsport?.trackStarts
        ? `${trackName}: ${travsport.trackWins}/${travsport.trackStarts} (Travsport)`
        : `${trackName || "?"} (hemma: ${homeTrack || "?"})`,
    },
    {
      id: "surface",
      category: "häst",
      label: "Underlag",
      score: surfaceScore,
      weight: 0.5,
      available: !!condition,
      note: condition ? `Banan: ${condition}` : "Ej rapporterat i API",
    },
    {
      id: "class",
      category: "häst",
      label: "Klassnivå (intjänat/start)",
      score: classScore,
      weight: 0.9,
      available: eps > 0,
      note: `EPS ${(eps / 100).toFixed(0)} vs fält median ${(medianEps / 100).toFixed(0)}`,
    },
    {
      id: "trainer",
      category: "häst",
      label: "Tränarform (2026)",
      score: trainerScore,
      weight: 1,
      available: trWin > 0,
      note: `${trainer?.shortName ?? "?"}: ${trWin.toFixed(1)}% vinst`,
    },
    {
      id: "equipment",
      category: "häst",
      label: "Utrustning (skor/sulky)",
      score: equipScore,
      weight: 0.7,
      available: !!shoes?.reported || !!h?.sulky?.reported,
      note: equipChanged
        ? "Ändring skor/sulky"
        : `Skor f:${shoes?.front?.hasShoe ? "J" : "N"} b:${shoes?.back?.hasShoe ? "J" : "N"}`,
    },
    {
      id: "pedigree",
      category: "häst",
      label: "Ålder & karriärfas",
      score: ageScore,
      weight: 0.65,
      available: !!h?.age,
      note: `${age} år — ${ageLabel}. Kön: ${h?.sex ?? "?"}, fader ${h?.pedigree?.father?.name ?? "?"}`,
    },
    {
      id: "speed",
      category: "häst",
      label: "Km-tid vs fält",
      score: speedScore,
      weight: 1,
      available: myTime != null,
      note: myTime != null
        ? `${usingRecentTimes ? `Snitt ${recentKmTimes.length} st` : "Rek"} ${myTime.toFixed(1)}s`
        : "Saknar km-tid",
    },
    {
      id: "rest",
      category: "häst",
      label: "Restitution",
      score: restScore,
      weight: 0.7,
      available: travsport?.daysSinceLastStart != null,
      note:
        travsport?.daysSinceLastStart != null
          ? `${travsport.daysSinceLastStart} dagar sedan start (Travsport)`
          : "Proxy via ATG starter 2026",
    },
    {
      id: "gallop_risk",
      category: "häst",
      label: "Galopp/stabilitetsrisk",
      score: travsport?.gallopProfile?.stabilityScore ?? 0.6,
      weight: 1.0,
      available: (travsport?.gallopProfile?.sampleSize ?? 0) >= 3,
      note: travsport?.gallopProfile?.note ?? "Saknar galopphistorik",
    },
  ];

  if (travsport?.gallopProfile?.riskLevel === "hög") {
    highlights.push(`Galoppfara hög (${Math.round(travsport.gallopProfile.gallopRate * 100)}%)`);
  }

  return {
    items,
    formTrend,
    highlights,
    tempoTripScore: travsport?.tempoTripProfile?.profileScore,
    tempoTripStyle: travsport?.tempoTripProfile?.style,
    gallopRiskScore: travsport?.gallopProfile?.stabilityScore,
    gallopRiskLevel: travsport?.gallopProfile?.riskLevel,
  };
}
