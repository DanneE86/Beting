import type { TravsportHorseProfile, TravsportStartRow } from "./types";

function parseKmTime(display: string | undefined, sortValue?: number): number | null {
  if (!display || display === "a" || display === "?") return null;
  const m = display.replace(",", ".").match(/(\d+)[,.]?(\d+)?/);
  if (!m) return sortValue != null && sortValue < 200 ? sortValue / 10 : null;
  const sec = Number(m[1]) * 60 + Number(m[2] ?? 0);
  return sec > 0 ? sec : null;
}

function parsePlacement(sortValue?: number, display?: string): number | null {
  if (display && /^\d+$/.test(display.trim())) return Number(display);
  if (sortValue == null || sortValue >= 100) return null;
  return sortValue;
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

  return {
    date: String(ri.date),
    displayDate: String(ri.displayDate ?? ""),
    trackCode: String(raw.trackCode ?? ""),
    raceNumber: Number(ri.raceNumber ?? 0),
    placement,
    placementDisplay: String((raw.placement as { displayValue?: string })?.displayValue ?? ""),
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
  };
}

function formTrendFromStarts(starts: TravsportStartRow[]): TravsportHorseProfile["formTrend"] {
  const done = starts.filter((s) => s.placement != null && s.placement > 0);
  if (done.length < 3) return "okänd";
  const recent = done.slice(0, 3).map((s) => s.placement!);
  const older = done.slice(3, 6).map((s) => s.placement!);
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
  };
}

/** ATG Solvalla etc. → Travsport banekod (förenklad). */
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
  return undefined;
}
