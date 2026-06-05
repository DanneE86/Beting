import type { AtgRace, AtgStart } from "../types";
import { normalizeTrackCondition, trackNameToCode } from "../travsport/parse";
import type { TravsportHorseProfile } from "../travsport/types";
import type { ChecklistItem, HorseDriverScores } from "./types";
import { distanceBand, distanceClass, distanceCorrectionSec, pctFromAtg, recordToSeconds, representativeMeters } from "./utils";

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

/** EWMA-baserad formtrend: vikterar de senaste starterna tyngre. */
function ewmaPlacement(places: number[], alpha = 0.38): number {
  if (!places.length) return 5;
  return places.reduce((ewma, p) => alpha * p + (1 - alpha) * ewma);
}

function formTrendFromPlaces(places: number[]): HorseDriverScores["formTrend"] {
  if (places.length < 3) return "okänd";
  const recent3 = ewmaPlacement(places.slice(-3));
  const older3 = ewmaPlacement(places.slice(-6, -3).length >= 2 ? places.slice(-6, -3) : places);
  if (recent3 < older3 - 0.6) return "stigande";
  if (recent3 > older3 + 0.6) return "nedåtgående";
  if (places.slice(-3).every((p) => p <= 3)) return "toppad";
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

function parseFirstPrizeKr(prize?: string): number | null {
  if (!prize) return null;
  const m = prize.match(/Pris:\s*([\d.]+)/);
  if (!m) return null;
  const v = parseFloat(m[1].replace(/\./g, ""));
  return Number.isFinite(v) && v > 0 ? v : null;
}

function parseClassRange(terms?: string[]): { lower: number; upper: number } | null {
  if (!terms?.length) return null;
  for (const t of terms) {
    const m = t.match(/([\d.]+)\s*[-–]\s*([\d.]+)\s*kr/);
    if (m) {
      const lower = parseFloat(m[1].replace(/\./g, ""));
      const upper = parseFloat(m[2].replace(/\./g, ""));
      if (Number.isFinite(lower) && Number.isFinite(upper) && upper > lower) {
        return { lower, upper };
      }
    }
  }
  return null;
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

  // EWMA-viktad placeringspoäng: senaste starterna väger tyngre
  function ewmaScore(ps: number[], alpha = 0.38): number {
    if (!ps.length) return 0.5;
    return ps.reduce((ewma, p) => alpha * Math.max(0, 1 - (p - 1) / 8) + (1 - alpha) * ewma);
  }
  const recentPlaceScore =
    tsPlaces.length > 0
      ? ewmaScore(tsPlaces)
      : places.length > 0
        ? ewmaScore(places)
        : 0.5;

  // Individuell startdistans = basdistans + eventuellt tillägg
  const raceDist = race.distance ?? start.distance;
  const startDist = start.distance ?? raceDist;
  const tillagg = raceDist && startDist ? startDist - raceDist : 0;
  const band = distanceBand(raceDist);
  const distCls = distanceClass(raceDist);
  const horseBand = h?.record?.distance ?? life?.records?.[0]?.distance;

  // Granulär distansmatch: exakt band + avstånd inom bandet
  const distMatch = horseBand === band;
  const distNearMatch =
    !distMatch &&
    ((horseBand === "medium" && band === "long" && (raceDist ?? 0) < 2400) ||
      (horseBand === "long" && band === "medium" && (raceDist ?? 0) > 2000));
  const distScore = distMatch ? 0.82 : distNearMatch ? 0.62 : horseBand ? 0.40 : 0.5;

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
  // Tilläggsstraff: varje 20m extra startsträcka ≈ ett spår längre bak
  if (tillagg > 0) {
    const tillaggPenalty = Math.min(0.20, (tillagg / 20) * 0.05);
    laneScore = Math.max(0.20, laneScore - tillaggPenalty);
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
  const normalizedCondition = condition ? normalizeTrackCondition(condition) : null;
  const surfaceMatch = normalizedCondition
    ? travsport?.surfaceHistory?.find((s) => s.condition === normalizedCondition)
    : null;
  const surfaceScore =
    surfaceMatch && surfaceMatch.starts >= 3
      ? Math.min(0.95, 0.35 + surfaceMatch.winRate * 1.8)
      : condition
        ? condition === "light"
          ? 0.6
          : 0.55
        : 0.5;

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
  const currentTrackCode = trackNameToCode(trackName);
  const trainerTrackStat = currentTrackCode
    ? travsport?.trainerTrackStats?.find((t) => t.trackCode === currentTrackCode)
    : null;
  const trainerGeneralScore = Math.min(1, trWin / 18);
  const trainerScore =
    trainerTrackStat && trainerTrackStat.starts >= 3
      ? trainerGeneralScore * 0.45 + Math.min(1, 0.30 + trainerTrackStat.winRate * 1.8) * 0.55
      : trainerGeneralScore;

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

  // Km-tider från Travsport, distanskorrigerade mot löpets distans (inkl. tillägg)
  const effectiveRaceDist = startDist ?? raceDist; // hästens faktiska distans i detta lopp
  const tsStarts = travsport?.recentStarts?.filter(
    (s) => s.kmTimeSeconds != null && !s.galloped && !s.disqualified,
  ) ?? [];

  // Föredra starter på liknande distans (±500 m); annars alla med korrektion
  const similarDistStarts = tsStarts.filter(
    (s) => s.distance != null && Math.abs(s.distance - (effectiveRaceDist ?? 0)) <= 500,
  );
  const useDistFiltered = similarDistStarts.length >= 2;
  const kmTimeBasis = useDistFiltered ? similarDistStarts : tsStarts;

  // Tillämpa distansskorrektion: +0,4 s/km om källdistansen är kortare än loppet
  const correctedKmTimes = kmTimeBasis
    .map((s) => {
      const raw = s.kmTimeSeconds!;
      if (!s.distance || !effectiveRaceDist) return raw;
      return raw + distanceCorrectionSec(s.distance, effectiveRaceDist);
    })
    .slice(0, 5);

  const usingRecentTimes = correctedKmTimes.length >= 2;
  const recentAvgTime = usingRecentTimes
    ? correctedKmTimes.reduce((ewma, t) => 0.45 * t + 0.55 * ewma)
    : null;

  // Fallback: ATG-rekord med bandbaserad distanskorrektion
  const recordTime = (() => {
    const raw = recordToSeconds(h?.record?.time);
    if (raw == null || !raceDist) return raw;
    const srcMeters = representativeMeters(horseBand);
    return raw + distanceCorrectionSec(srcMeters, raceDist);
  })();

  const myTime = recentAvgTime ?? recordTime;

  // Fälttider: ATG-rekord distanskorrigerade per häst
  const fieldTimes = fieldStarts
    .map((s) => {
      const raw = recordToSeconds(s.horse?.record?.time);
      if (raw == null || !raceDist) return raw;
      const srcBand = s.horse?.record?.distance ?? life?.records?.[0]?.distance;
      const srcMeters = representativeMeters(srcBand);
      return raw + distanceCorrectionSec(srcMeters, raceDist);
    })
    .filter((t): t is number => t != null)
    .sort((a, b) => a - b);

  // Median ger jämnare kalibrering än bästa häst
  const medianTime = fieldTimes.length > 0
    ? fieldTimes[Math.floor((fieldTimes.length - 1) / 2)]
    : null;
  const speedScore =
    myTime != null && medianTime != null
      ? Math.min(1, Math.max(0.2, 0.5 + (medianTime - myTime) / 6))
      : 0.5;

  const starts2026 = y2026?.starts ?? 0;
  const restScore = travsport?.daysSinceLastStart != null
    ? restScoreFromDays(travsport.daysSinceLastStart)
    : starts2026 <= 3
      ? 0.65
      : starts2026 >= 12
        ? 0.5
        : 0.6;

  // Loppklass: jämför hästen mot klassintervallet i loppets villkor
  const firstPrizeKr = parseFirstPrizeKr(race.prize);
  const classRange = parseClassRange(race.terms);
  const lifeStarts = life?.starts ?? 0;
  const totalEarningsKr = lifeStarts > 0 ? (eps / 100) * lifeStarts : null;
  let raceQualityScore = 0.5;
  let raceQualityNote = "Klassdata saknas";
  if (classRange && totalEarningsKr != null) {
    const pos = Math.max(0, Math.min(1, (totalEarningsKr - classRange.lower) / (classRange.upper - classRange.lower)));
    raceQualityScore = Math.min(0.88, Math.max(0.25, 0.3 + pos * 0.58));
    const posLabel = pos >= 0.75 ? "topp av klass" : pos >= 0.4 ? "mittfältet" : "ny i klassen";
    raceQualityNote = `Totalt ~${Math.round(totalEarningsKr / 1000)}k kr · klass ${Math.round(classRange.lower / 1000)}k–${Math.round(classRange.upper / 1000)}k kr (${posLabel})`;
    if (firstPrizeKr) raceQualityNote += ` · 1:a pris ${Math.round(firstPrizeKr / 1000)}k kr`;
  } else if (firstPrizeKr) {
    raceQualityScore = 0.5;
    raceQualityNote = `1:a pris ${Math.round(firstPrizeKr / 1000)}k kr`;
  }

  // Uthållighet på lång distans (≥ 2200 m) — ultralong (≥ 2600 m) hårdare krav
  const isLongDist = distCls === "long" || distCls === "ultralong";
  const isUltraLong = distCls === "ultralong";
  const tempoStyle = travsport?.tempoTripProfile?.style;
  let longDistScore = 0.5;
  let longDistNote = "Ej långdistans";
  if (isLongDist) {
    const sampleSize = travsport?.tempoTripProfile?.sampleSize ?? 0;
    const closerBonus = isUltraLong ? 0.90 : 0.82;
    const versatileScore = isUltraLong ? 0.72 : 0.70;
    const frontPenalty = isUltraLong ? 0.22 : 0.32;
    const unknownBase = sampleSize >= 3 ? 0.50 : 0.52;
    const distLabel = isUltraLong ? "ultra-lång distans (≥2600m)" : "lång distans";

    if (tempoStyle === "closer") {
      longDistScore = closerBonus;
      longDistNote = `Avslutare — gynnas av ${distLabel}`;
    } else if (tempoStyle === "versatile") {
      longDistScore = versatileScore;
      longDistNote = `Flexibel löpstil — klarar ${distLabel}`;
    } else if (tempoStyle === "front") {
      longDistScore = frontPenalty;
      longDistNote = `Front-löpare — uthållighetsrisk på ${distLabel}`;
    } else {
      longDistScore = unknownBase;
      longDistNote = sampleSize >= 3 ? `Oklar löpstil på ${distLabel}` : `För lite data — uthållighet okänd (${distLabel})`;
    }

    // Bonus om hästen har bekräftade rekord på lång/ultralång distans
    const hasLongRecord = (life?.records ?? []).some((r) => r.distance === "long");
    if (hasLongRecord) {
      longDistScore = Math.min(0.92, longDistScore + 0.08);
      longDistNote += " · bekräftat rekord på lång dist.";
    }

    // Travsport: kontrollera om hästen har bra resultat på liknande distans
    const longDistStarts = tsStarts.filter((s) => s.distance != null && s.distance >= 2200);
    if (longDistStarts.length >= 3) {
      const longDistWins = longDistStarts.filter((s) => s.placement === 1).length;
      const longDistTop3 = longDistStarts.filter((s) => (s.placement ?? 99) <= 3).length;
      const winRate = longDistWins / longDistStarts.length;
      if (winRate >= 0.25) {
        longDistScore = Math.min(0.92, longDistScore + 0.06);
        longDistNote += ` · ${longDistWins}/${longDistStarts.length} segrar ≥2200m`;
      } else if (longDistTop3 / longDistStarts.length < 0.25 && longDistStarts.length >= 4) {
        longDistScore = Math.max(0.20, longDistScore - 0.08);
        longDistNote += ` · svag historik ≥2200m (${longDistTop3}/${longDistStarts.length} topp-3)`;
      } else {
        longDistNote += ` · ${longDistTop3}/${longDistStarts.length} topp-3 ≥2200m`;
      }
    }

    // Gallopstraff: hög galoppfara på lång distans är allvarligare
    if (travsport?.gallopProfile?.riskLevel === "hög") {
      const penalty = isUltraLong ? 0.16 : 0.12;
      longDistScore = Math.max(0.15, longDistScore - penalty);
      longDistNote += ` · hög galoppfara på ${isUltraLong ? "ultra-lång" : "lång"} dist`;
    }
  }

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
  if (myTime != null && medianTime != null && myTime <= medianTime - 0.5)
    highlights.push("Snabb km-tid i fältet");
  if (classRange && totalEarningsKr != null) {
    const pos = (totalEarningsKr - classRange.lower) / (classRange.upper - classRange.lower);
    if (pos >= 0.8) highlights.push("Topp av klassen — klassövertag");
    else if (pos < 0.2) highlights.push("Ny i klassen — klassprövning");
  }
  if (isUltraLong && tempoStyle === "front") highlights.push("Front-löpare på ultra-lång distans (≥2600m) — hög uthållighetsrisk");
  else if (isLongDist && tempoStyle === "front") highlights.push("Front-löpare på lång distans — uthållighetsrisk");
  if (isUltraLong && tempoStyle === "closer") highlights.push("Avslutare — starkt gynnad på ultra-lång distans");
  else if (isLongDist && tempoStyle === "closer") highlights.push("Avslutare gynnas på lång distans");
  if (tillagg > 0) highlights.push(`Tillägg ${tillagg}m — startar längre bak`);

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
      weight: isLongDist ? 1.6 : 1.1,
      available: !!raceDist,
      note: `${startDist ?? raceDist ?? "?"}m${tillagg > 0 ? ` (+${tillagg}m tillägg)` : ""} (${distCls}), häst: ${horseBand ?? "?"}`,
    },
    {
      id: "lane_start",
      category: "häst",
      label: "Spår & starttyp",
      score: laneScore,
      weight: 0.9,
      available: true,
      note: `Spår ${post}, ${raceMethod}${isVolt ? " (volt)" : " (auto)"}${tillagg > 0 ? ` +${tillagg}m tillägg` : ""}${laneHistory ? ` · ${laneHistory.note}` : ""}`,
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
      note: surfaceMatch && surfaceMatch.starts >= 3
        ? `Banan: ${condition} · häst ${surfaceMatch.wins}/${surfaceMatch.starts} segrar (${Math.round(surfaceMatch.winRate * 100)}%)`
        : condition
          ? `Banan: ${condition} (för lite historik)`
          : "Ej rapporterat i API",
    },
    {
      id: "race_quality",
      category: "häst",
      label: "Loppklass & klassposition",
      score: raceQualityScore,
      weight: 1.1,
      available: classRange != null || firstPrizeKr != null,
      note: raceQualityNote,
    },
    {
      id: "class",
      category: "häst",
      label: "Klassnivå (intjänat/start)",
      score: classScore,
      weight: 0.7,
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
      note: trainerTrackStat && trainerTrackStat.starts >= 3
        ? `${trainer?.shortName ?? "?"}: ${trWin.toFixed(1)}% vinst · ${trackName} ${trainerTrackStat.wins}/${trainerTrackStat.starts} (${Math.round(trainerTrackStat.winRate * 100)}%)`
        : `${trainer?.shortName ?? "?"}: ${trWin.toFixed(1)}% vinst (ingen banspec. historik)`,
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
      weight: 1.5,
      available: myTime != null,
      note: (() => {
        if (myTime == null) return "Saknar km-tid";
        const src = usingRecentTimes
          ? `Snitt ${correctedKmTimes.length} st${useDistFiltered ? ` (dist-filtrerat)` : " (dist-korr)"}`
          : "Rek (dist-korr)";
        const medStr = medianTime != null ? ` vs fält ${medianTime.toFixed(1)}s` : "";
        return `${src}: ${myTime.toFixed(1)}s${medStr}`;
      })(),
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
      id: "tempo_trip",
      category: "häst",
      label: "Tempo/trip-profil",
      score: travsport?.tempoTripProfile?.profileScore ?? 0.5,
      weight: isLongDist ? 1.3 : 0.85,
      available: (travsport?.tempoTripProfile?.sampleSize ?? 0) >= 3,
      note: travsport?.tempoTripProfile
        ? `${travsport.tempoTripProfile.style}: ${travsport.tempoTripProfile.note}`
        : "Ingen profildata",
    },
    {
      id: "longdist_endurance",
      category: "häst",
      label: "Uthållighet (lång distans)",
      score: longDistScore,
      weight: isLongDist ? 1.2 : 0,
      available: isLongDist,
      note: longDistNote,
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
  if (travsport?.tempoTripProfile && travsport.tempoTripProfile.sampleSize >= 3 && travsport.tempoTripProfile.profileScore >= 0.72) {
    highlights.push(`Stark tempo/trip-match (${travsport.tempoTripProfile.style})`);
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
