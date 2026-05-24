import { fetchCalendarDay } from "./atg-api";
import type { PoolGameType } from "./types";

export type CalendarGameEntry = {
  id: string;
  status?: string;
  startTime?: string;
  scheduledStartTime?: string;
  name?: string;
};

const SCAN_DAYS_AHEAD = 28;

function parseStart(iso?: string): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** 0=sön … 6=lör */
export function weekdayFromIso(iso?: string): number | null {
  const d = parseStart(iso);
  return d ? d.getDay() : null;
}

export function isSaturdayStart(iso?: string): boolean {
  return weekdayFromIso(iso) === 6;
}

function addDaysIso(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T12:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Alla V85-omgångar från fromDate och upp till 4 veckor framåt. */
export async function collectUpcomingV85(fromDate: string): Promise<
  {
    calendarDate: string;
    entry: CalendarGameEntry;
    startIso: string;
    isSaturday: boolean;
  }[]
> {
  const found: {
    calendarDate: string;
    entry: CalendarGameEntry;
    startIso: string;
    isSaturday: boolean;
  }[] = [];
  const seen = new Set<string>();

  for (let i = 0; i <= SCAN_DAYS_AHEAD; i++) {
    const day = addDaysIso(fromDate, i);
    let cal: Awaited<ReturnType<typeof fetchCalendarDay>>;
    try {
      cal = await fetchCalendarDay(day);
    } catch {
      continue;
    }
    const entries = cal.games?.V85 as CalendarGameEntry[] | undefined;
    if (!entries?.length) continue;

    for (const entry of entries) {
      if (!entry.id || seen.has(entry.id)) continue;
      seen.add(entry.id);
      const startIso = entry.startTime ?? entry.scheduledStartTime ?? `${day}T12:00:00`;
      found.push({
        calendarDate: day,
        entry,
        startIso,
        isSaturday: isSaturdayStart(startIso),
      });
    }
  }

  found.sort((a, b) => a.startIso.localeCompare(b.startIso));
  return found;
}

/** Nästa kommande lördags-V85, annars nästa V85 i tiden. */
export async function resolvePrimaryV85(fromDate: string): Promise<{
  gameId: string;
  gameType: PoolGameType;
  startTime: string;
  calendarDate: string;
  isSaturdayRound: boolean;
} | null> {
  const upcoming = await collectUpcomingV85(fromDate);
  if (upcoming.length === 0) return null;

  const now = Date.now();
  const future = upcoming.filter((u) => parseStart(u.startIso)!.getTime() >= now - 60 * 60 * 1000);
  const pool = future.length > 0 ? future : upcoming;

  const saturday = pool.filter((u) => u.isSaturday);
  const pick = saturday[0] ?? pool[0];

  return {
    gameId: pick.entry.id,
    gameType: "V85",
    startTime: pick.startIso,
    calendarDate: pick.calendarDate,
    isSaturdayRound: pick.isSaturday,
  };
}

export function nextSaturdayIso(fromDate: string): string {
  const d = new Date(`${fromDate}T12:00:00`);
  const day = d.getDay();
  if (day === 6) return fromDate;
  const add = day === 0 ? 6 : 6 - day;
  d.setDate(d.getDate() + add);
  return d.toISOString().slice(0, 10);
}

/** V85 på eller före nästa lördag (lördagsomgången). */
export async function resolveV85ForNextSaturday(fromDate: string): Promise<ReturnType<
  typeof resolvePrimaryV85
> | null> {
  const sat = nextSaturdayIso(fromDate);
  const satEnd = new Date(`${sat}T23:59:59`).getTime();
  const upcoming = await collectUpcomingV85(fromDate);

  const onOrBeforeSat = upcoming.filter((u) => {
    const t = parseStart(u.startIso)!.getTime();
    return t <= satEnd;
  });

  if (onOrBeforeSat.length === 0) return resolvePrimaryV85(fromDate);

  const saturdayRound = onOrBeforeSat.filter((u) => u.isSaturday);
  const pick = saturdayRound[saturdayRound.length - 1] ?? onOrBeforeSat[onOrBeforeSat.length - 1];

  return {
    gameId: pick.entry.id,
    gameType: "V85",
    startTime: pick.startIso,
    calendarDate: pick.calendarDate,
    isSaturdayRound: pick.isSaturday,
  };
}
