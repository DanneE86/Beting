import type { TravsportHorseProfile, TravsportStartRow } from "./types";

function parseKmTime(display: string | undefined, sortValue?: number): number | null {
  if (!display || display === "a" || display === "?") return null;
  // Swedish format "1.14,5" or "1:14,5" = 1min 14.5s = 74.5s
  const full = display.match(/^(\d+)[.:](\d{1,2})[,.](\d)$/);
  if (full) return Number(full[1]) * 60 + Number(full[2]) + Number(full[3]) / 10;
  // No tenths: "1.14" or "1:14"
  const noTenths = display.match(/^(\d+)[.:](\d{1,2})$/);
  if (noTenths) return Number(noTenths[1]) * 60 + Number(noTenths[2]);
  return sortValue != null && sortValue > 0 && sortValue < 9000 ? sortValue / 10 : null;
}

function parsePlacement(sortValue?: number, display?: string): number | null {
  if (display && /^\d+$/.test(display.trim())) return Number(display);
  if (sortValue == null || sortValue >= 100) return null;
  return sortValue;
}

function normalizeResultCode(display?: string): string {
  return String(display ?? "").trim().toLowerCase();
}

function rowGalloped(resultCode: string): boolean {
  if (!resultCode) return false;
  return /\bg\b/.test(resultCode) || resultCode.includes("dg") || resultCode.includes("dgm") || resultCode.includes("galopp");
}

function rowDisqualified(resultCode: string): boolean {
  if (!resultCode) return false;
  return resultCode === "d" || resultCode.startsWith("dg") || resultCode.startsWith("dist") || resultCode.includes("disk");
}

function buildTripComment(
  placement: number | null,
  startPosition: number | null,
  resultCode: string,
  withdrawn: boolean,
): string {
  if (withdrawn || resultCode.startsWith("str")) return "struken";
  if (rowDisqualified(resultCode)) return "diskvalificerad i loppet";
  if (rowGalloped(resultCode)) return "galopp i loppet";
  if (placement == null || placement <= 0) return "okänd resa";

  const fromBack = (startPosition ?? 0) >= 8;
  const fromFront = (startPosition ?? 99) <= 4;
  if (placement <= 3 && fromBack) return "stark avslutning bakifrån";
  if (placement <= 3 && fromFront) return "bra resa i främre träffen";
  if (placement >= 7 && fromFront) return "tuff resa i främre träffen";
  if (placement >= 7 && fromBack) return "svag avslutning bakifrån";
  return "jämn resa";
}

export function parseResultRow(raw: Record<string, unknown>): TravsportStartRow | null {
  const ri = raw.raceInformation as Record<string, unknown> | undefined;
  if (!ri?.date) return null;

  const placement = parsePlacement(
    (raw.placement as { sortValue?: number })?.sortValue,
    (raw.placement as { displayValue?: string })?.displayValue,
  );
  const kmDisplay = (raw.kilometerTime as { displayValue?: string })?.displayValue;
  const kmSort = (raw.kilometerTime as { sortValue?: number })?.sortValue;

  const driver = raw.driver as { id?: number; name?: string } | undefined;
  const trainer = raw.trainer as { id?: number; name?: string } | undefined;
  const shoes = (raw.equipmentOptions as { shoeOptions?: { code?: string } })?.shoeOptions;
  const placementDisplay = String((raw.placement as { displayValue?: string })?.displayValue ?? "");
  const resultCode = normalizeResultCode(placementDisplay);

  return {
    date: String(ri.date),
    displayDate: String(ri.displayDate ?? ""),
    trackCode: String(raw.trackCode ?? ""),
    raceNumber: Number(ri.raceNumber ?? 0),
    placement,
    placementDisplay,
    resultCode,
    kmTime: kmDisplay ?? null,
    kmTimeSeconds: parseKmTime(kmDisplay, kmSort),
    startPosition: Number((raw.startPosition as { sortValue?: number })?.sortValue ?? 0) || null,
    distance: Number((raw.distance as { sortValue?: number })?.sortValue ?? 0) || null,
    startMethod: String(raw.startMethod ?? ""),
    trackCondition: String(raw.trackCondition ?? ""),
    driverId: driver?.id ?? null,
    driverName: driver?.name ?? "",
    trainerId: trainer?.id ?? null,
    trainerName: trainer?.name ?? "",
    odds: String((raw.odds as { displayValue?: string })?.displayValue ?? ""),
    shoeCode: shoes?.code ?? "",
    withdrawn: Boolean(raw.withdrawn),
    galloped: rowGalloped(resultCode),
    disqualified: rowDisqualified(resultCode),
    tripComment: buildTripComment(
      placement,
      Number((raw.startPosition as { sortValue?: number })?.sortValue ?? 0) || null,
      resultCode,
      Boolean(raw.withdrawn),
    ),
  };
}

function formTrendFromStarts(starts: TravsportStartRow[]): TravsportHorseProfile["formTrend"] {
  const relevant = starts.filter((s) => !s.withdrawn && !s.resultCode.startsWith("str"));
  if (relevant.length < 3) return "okänd";
  const toPlacing = (s: TravsportStartRow): number =>
    s.galloped || s.disqualified ? 8 : (s.placement ?? 8);
  const recent = relevant.slice(0, 3).map(toPlacing);
  const older = relevant.slice(3, 6).map(toPlacing);
  const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
  const r = avg(recent);
  const o = avg(older);
  if (older.length === 0) return recent.every((p) => p <= 3) ? "toppad" : "okänd";
  if (r < o - 0.6) return "stigande";
  if (r > o + 0.6) return "nedåtgående";
  if (recent.every((p) => p <= 3)) return "toppad";
  return "okänd";
}

function daysSince(dateIso: string): number {
  const d = new Date(dateIso);
  const now = new Date();
  return Math.floor((now.getTime() - d.getTime()) / 86400000);
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function scoreFromPlacings(placings: number[]): number {
  if (!placings.length) return 0.5;
  const wins = placings.filter((p) => p === 1).length;
  const top3 = placings.filter((p) => p <= 3).length;
  const avgPlacement = placings.reduce((sum, p) => sum + p, 0) / placings.length;
  return clamp01(0.25 + (wins / placings.length) * 0.35 + (top3 / placings.length) * 0.2 + Math.max(0, 1 - (avgPlacement - 1) / 8) * 0.2);
}

function buildTempoTripProfile(starts: TravsportStartRow[]) {
  const completed = starts.filter(
    (row) => !row.withdrawn && !row.resultCode.startsWith("str") && row.placement != null && row.placement > 0,
  );
  const sample = completed.slice(0, 12);
  if (sample.length === 0) {
    return {
      sampleSize: 0,
      earlySpeedScore: 0.5,
      closingSpeedScore: 0.5,
      versatilityScore: 0.5,
      profileScore: 0.5,
      style: "okänd" as const,
      note: "Ingen tydlig tempo/trip-historik ännu",
    };
  }

  const frontRows = sample.filter((row) => (row.startPosition ?? 99) <= 4);
  const backRows = sample.filter((row) => (row.startPosition ?? 0) >= 8);
  const frontPlacings = frontRows.map((row) => row.placement!).filter((p) => p > 0);
  const backPlacings = backRows.map((row) => row.placement!).filter((p) => p > 0);

  const earlySpeedScore = frontPlacings.length > 0 ? scoreFromPlacings(frontPlacings) : 0.5;
  const closingSpeedScore = backPlacings.length > 0 ? scoreFromPlacings(backPlacings) : 0.5;
  const versatilityScore = clamp01(0.35 + Math.min(earlySpeedScore, closingSpeedScore) * 0.65);
  const profileScore = clamp01(earlySpeedScore * 0.4 + closingSpeedScore * 0.35 + versatilityScore * 0.25);

  const style =
    earlySpeedScore >= 0.68 && earlySpeedScore - closingSpeedScore >= 0.08
      ? ("front" as const)
      : closingSpeedScore >= 0.68 && closingSpeedScore - earlySpeedScore >= 0.08
        ? ("closer" as const)
        : sample.length >= 4
          ? ("versatile" as const)
          : ("okänd" as const);

  const note =
    style === "front"
      ? `Tidig ledarprofil: ${frontPlacings.length} relevanta framspårsstarter`
      : style === "closer"
        ? `Bakifrånprofil: ${backPlacings.length} relevanta bakspårsstarter`
        : style === "versatile"
          ? `Allround tripprofil över ${sample.length} starter`
          : `Begränsad tempo/trip-data (${sample.length} starter)`;

  return {
    sampleSize: sample.length,
    earlySpeedScore,
    closingSpeedScore,
    versatilityScore,
    profileScore,
    style,
    note,
  };
}

function buildGallopProfile(starts: TravsportStartRow[]) {
  const sample = starts
    .filter((row) => !row.withdrawn && !row.resultCode.startsWith("str"))
    .filter((row) => row.placement != null || row.galloped || row.disqualified || row.resultCode === "0")
    .slice(0, 12);
  if (sample.length === 0) {
    return {
      sampleSize: 0,
      gallopStarts: 0,
      gallopRate: 0,
      recentGallopRate: 0,
      stabilityScore: 0.5,
      riskLevel: "medel" as const,
      note: "Ingen galopphistorik ännu",
    };
  }

  const recent = sample.slice(0, 5);
  const gallopStarts = sample.filter((row) => row.galloped || row.disqualified).length;
  const gallopRate = gallopStarts / sample.length;
  const recentGallopRate = recent.length
    ? recent.filter((row) => row.galloped || row.disqualified).length / recent.length
    : gallopRate;
  const stabilityScore = clamp01(1 - (gallopRate * 0.6 + recentGallopRate * 0.4));
  const riskLevel =
    recentGallopRate >= 0.34 || gallopRate >= 0.3
      ? ("hög" as const)
      : recentGallopRate >= 0.18 || gallopRate >= 0.14
        ? ("medel" as const)
        : ("låg" as const);

  return {
    sampleSize: sample.length,
    gallopStarts,
    gallopRate,
    recentGallopRate,
    stabilityScore,
    riskLevel,
    note: `${gallopStarts}/${sample.length} starter med galopp/disk (${Math.round(gallopRate * 100)}%)`,
  };
}

export function buildHorseProfile(
  horseId: number,
  rawRows: unknown[],
  opts?: { trackCode?: string; driverId?: number },
): TravsportHorseProfile {
  const starts = rawRows
    .map((r) => parseResultRow(r as Record<string, unknown>))
    .filter((s): s is TravsportStartRow => s != null)
    .sort((a, b) => b.date.localeCompare(a.date));

  const completed = starts.filter((s) => s.placement != null && s.placement > 0 && s.placement < 90);
  const recentStarts = completed.slice(0, 6);

  const trackCode = opts?.trackCode?.toUpperCase();
  const trackRows = trackCode
    ? completed.filter((s) => s.trackCode.toUpperCase() === trackCode)
    : [];
  const driverId = opts?.driverId;
  const pairRows = driverId
    ? completed.filter((s) => s.driverId === driverId)
    : [];
  const tempoTripProfile = buildTempoTripProfile(completed);
  const gallopProfile = buildGallopProfile(starts);

  return {
    horseId,
    fetchedAt: new Date().toISOString(),
    starts,
    recentStarts,
    formTrend: formTrendFromStarts(recentStarts),
    daysSinceLastStart: completed[0] ? daysSince(completed[0].date) : null,
    trackStarts: trackRows.length,
    trackWins: trackRows.filter((s) => s.placement === 1).length,
    driverPairStarts: pairRows.length,
    driverPairWins: pairRows.filter((s) => s.placement === 1).length,
    tempoTripProfile,
    gallopProfile,
  };
}

export function hydrateHorseProfile(profile: TravsportHorseProfile): TravsportHorseProfile {
  const starts = (profile.starts ?? []).map((row) => {
    const resultCode = row.resultCode ?? normalizeResultCode(row.placementDisplay);
    const startPosition = row.startPosition ?? null;
    const placement = row.placement ?? null;
    const withdrawn = Boolean(row.withdrawn);
    return {
      ...row,
      resultCode,
      galloped: row.galloped ?? rowGalloped(resultCode),
      disqualified: row.disqualified ?? rowDisqualified(resultCode),
      tripComment: row.tripComment ?? buildTripComment(placement, startPosition, resultCode, withdrawn),
    };
  });

  return {
    ...profile,
    starts,
    recentStarts: (profile.recentStarts ?? starts.slice(0, 6)).map((row) => {
      const resultCode = row.resultCode ?? normalizeResultCode(row.placementDisplay);
      const startPosition = row.startPosition ?? null;
      const placement = row.placement ?? null;
      const withdrawn = Boolean(row.withdrawn);
      return {
        ...row,
        resultCode,
        galloped: row.galloped ?? rowGalloped(resultCode),
        disqualified: row.disqualified ?? rowDisqualified(resultCode),
        tripComment: row.tripComment ?? buildTripComment(placement, startPosition, resultCode, withdrawn),
      };
    }),
    tempoTripProfile: profile.tempoTripProfile ?? buildTempoTripProfile(starts),
    gallopProfile: profile.gallopProfile ?? buildGallopProfile(starts),
  };
}

/** ATG track name → Travsport track code. */
export function trackNameToCode(trackName?: string): string | undefined {
  if (!trackName) return undefined;
  const t = trackName.toLowerCase();
  if (t.includes("solv")) return "S";
  if (t.includes("åby") || t.includes("aby")) return "Å";
  if (t.includes("jäger") || t.includes("jager")) return "J";
  if (t.includes("bergs")) return "B";
  if (t.includes("färje") || t.includes("farje")) return "F";
  if (t.includes("örebro") || t.includes("orebro")) return "Ö";
  if (t.includes("eskil")) return "E";
  if (t.includes("hagmyr")) return "H";
  if (t.includes("romme")) return "R";
  if (t.includes("axev")) return "AX";
  if (t.includes("boden")) return "BO";
  if (t.includes("gävle") || t.includes("gavle")) return "GÄ";
  if (t.includes("halmstad")) return "HA";
  if (t.includes("kalmar")) return "K";
  if (t.includes("lindes")) return "L";
  if (t.includes("mantorp")) return "MA";
  if (t.includes("sundsvall")) return "SUN";
  if (t.includes("östersund") || t.includes("ostersund")) return "ÖS";
  if (t.includes("umåker") || t.includes("umak") || t.includes("strömsh")) return "UM";
  if (t.includes("visby")) return "VI";
  if (t.includes("tingsryd")) return "TG";
  if (t.includes("skelleft")) return "SKE";
  if (t.includes("dannero") || t.includes("nyköping") || t.includes("nykoping")) return "DA";
  return undefined;
}
