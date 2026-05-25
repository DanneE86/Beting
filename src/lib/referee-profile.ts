import { espnGet, fetchScoreboardRange, summaryUrl } from "./espn.api";

export type RefereeMatchSample = {
  yellowCards: number;
  redCards: number;
  fouls: number;
  penalties: number;
};

export type RefereeProfile = {
  name: string;
  sampleSize: number;
  avgYellowCards: number | null;
  avgRedCards: number | null;
  avgFouls: number | null;
  penaltiesPerMatch: number | null;
  style: "kortbenagen" | "balanserad" | "slapper-pa" | "okand";
  note: string;
};

const REFEREE_PROFILE_CACHE = new Map<string, Promise<RefereeProfile | null>>();

function normName(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function asNumber(value: unknown): number | null {
  const n = Number(String(value ?? "").replace(",", ".").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function sumStatValues(statsGroups: any[], names: string[]) {
  const wanted = new Set(names.map((name) => normName(name)));
  let total = 0;
  let found = false;

  for (const group of statsGroups) {
    const stats = Array.isArray(group?.statistics) ? group.statistics : [];
    for (const stat of stats) {
      const key = normName(String(stat?.name ?? stat?.displayName ?? stat?.abbreviation ?? stat?.type ?? ""));
      if (!wanted.has(key)) continue;
      const value = asNumber(stat?.displayValue ?? stat?.value);
      if (value == null) continue;
      total += value;
      found = true;
    }
  }

  return found ? total : null;
}

export function extractRefereeName(summary: any): string | null {
  const officials: any[] =
    summary?.gameInfo?.officials ??
    summary?.header?.competitions?.[0]?.officials ??
    summary?.boxscore?.officials ??
    [];
  const referee =
    officials.find(
      (o) =>
        /referee|domare/i.test(o?.position?.name ?? o?.position?.abbreviation ?? "") || o?.order === 1,
    )?.displayName ??
    officials[0]?.displayName ??
    null;
  return referee ? String(referee) : null;
}

function countPenalties(summary: any) {
  const plays = [
    ...(Array.isArray(summary?.plays) ? summary.plays : []),
    ...(Array.isArray(summary?.scoringPlays) ? summary.scoringPlays : []),
  ];
  let penalties = 0;
  for (const play of plays) {
    const text = `${play?.text ?? play?.shortText ?? play?.headline ?? play?.type?.text ?? ""}`.toLowerCase();
    if (text.includes("penalty")) penalties++;
  }
  return penalties;
}

export function extractRefereeMatchSample(summary: any): RefereeMatchSample | null {
  const statsGroups = Array.isArray(summary?.boxscore?.teams)
    ? summary.boxscore.teams
    : Array.isArray(summary?.statistics)
      ? summary.statistics
      : [];
  if (!statsGroups.length) return null;

  const yellowCards = sumStatValues(statsGroups, ["yellowcards", "yellow cards", "yc"]);
  const redCards = sumStatValues(statsGroups, ["redcards", "red cards", "rc"]);
  const fouls = sumStatValues(statsGroups, ["foulscommitted", "fouls committed", "fouls"]);
  const penalties = countPenalties(summary);

  if (yellowCards == null && redCards == null && fouls == null && penalties === 0) return null;
  return {
    yellowCards: yellowCards ?? 0,
    redCards: redCards ?? 0,
    fouls: fouls ?? 0,
    penalties,
  };
}

function avg(values: number[]) {
  if (!values.length) return null;
  return Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10) / 10;
}

export function summarizeRefereeSamples(
  name: string,
  samples: RefereeMatchSample[],
): RefereeProfile | null {
  if (!samples.length) return null;

  const avgYellowCards = avg(samples.map((sample) => sample.yellowCards));
  const avgRedCards = avg(samples.map((sample) => sample.redCards));
  const avgFouls = avg(samples.map((sample) => sample.fouls));
  const penaltiesPerMatch = avg(samples.map((sample) => sample.penalties));

  const yellow = avgYellowCards ?? 0;
  const red = avgRedCards ?? 0;
  const fouls = avgFouls ?? 0;

  let style: RefereeProfile["style"] = "balanserad";
  if (yellow >= 5.6 || red >= 0.35) style = "kortbenagen";
  else if (yellow <= 3.6 && fouls <= 22) style = "slapper-pa";

  const styleText =
    style === "kortbenagen"
      ? "kortbenagen"
      : style === "slapper-pa"
        ? "slapper pa-spelet"
        : "balanserad";

  return {
    name,
    sampleSize: samples.length,
    avgYellowCards,
    avgRedCards,
    avgFouls,
    penaltiesPerMatch,
    style,
    note: `${name}: ${styleText}, snitt ${avgYellowCards ?? "—"} gula / ${avgRedCards ?? "—"} roda / ${avgFouls ?? "—"} fouls over ${samples.length} matcher.`,
  };
}

export async function getRefereeProfile(input: {
  leagueId: string;
  refereeName: string | null | undefined;
  eventId?: string | null;
  eventDate?: string | null;
  lookbackDays?: number;
  maxSamples?: number;
  maxEventsToScan?: number;
}): Promise<RefereeProfile | null> {
  const refereeName = input.refereeName?.trim();
  if (!refereeName) return null;

  const anchor = input.eventDate ? new Date(input.eventDate) : new Date();
  const bucket = `${anchor.getUTCFullYear()}-${String(anchor.getUTCMonth() + 1).padStart(2, "0")}`;
  const cacheKey = `${input.leagueId}:${normName(refereeName)}:${bucket}`;
  const existing = REFEREE_PROFILE_CACHE.get(cacheKey);
  if (existing) return existing;

  const promise = (async () => {
    const lookbackDays = input.lookbackDays ?? 160;
    const maxSamples = input.maxSamples ?? 10;
    const maxEventsToScan = input.maxEventsToScan ?? 40;
    const from = new Date(anchor.getTime() - lookbackDays * 86400_000);
    const events = await fetchScoreboardRange(
      input.leagueId,
      from.toISOString().slice(0, 10).replace(/-/g, ""),
      anchor.toISOString().slice(0, 10).replace(/-/g, ""),
    ).catch(() => []);

    const candidates = events
      .filter((event: any) => event?.status?.type?.completed)
      .filter((event: any) => String(event?.id ?? "") !== String(input.eventId ?? ""))
      .filter((event: any) => {
        const date = event?.date ? new Date(event.date).getTime() : 0;
        return Number.isFinite(date) && date < anchor.getTime();
      })
      .sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime())
      .slice(0, maxEventsToScan);

    const samples: RefereeMatchSample[] = [];
    for (const event of candidates) {
      const summary = await espnGet<any>(summaryUrl(input.leagueId, String(event.id))).catch(() => null);
      if (!summary) continue;
      const summaryRef = extractRefereeName(summary);
      if (!summaryRef || normName(summaryRef) !== normName(refereeName)) continue;
      const sample = extractRefereeMatchSample(summary);
      if (!sample) continue;
      samples.push(sample);
      if (samples.length >= maxSamples) break;
    }

    return summarizeRefereeSamples(refereeName, samples);
  })();

  REFEREE_PROFILE_CACHE.set(cacheKey, promise);
  try {
    return await promise;
  } catch (error) {
    REFEREE_PROFILE_CACHE.delete(cacheKey);
    throw error;
  }
}
