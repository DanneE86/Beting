/** ESPN public soccer API — ingen nyckel krävs. */
export const ESPN_BASE = "https://site.api.espn.com/apis";

export async function espnGet<T = unknown>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`ESPN ${res.status}: ${url}`);
  return res.json() as Promise<T>;
}

/** YYYYMMDD (UTC) — samma format överallt. */
export function espnYmd(d: Date): string {
  return d.toISOString().slice(0, 10).replace(/-/g, "");
}

export function scoreboardUrl(leagueId: string, fromYmd: string, toYmd: string, limit = 200): string {
  return `${ESPN_BASE}/site/v2/sports/soccer/${leagueId}/scoreboard?dates=${fromYmd}-${toYmd}&limit=${limit}`;
}

export function summaryUrl(leagueId: string, eventId: string): string {
  return `${ESPN_BASE}/site/v2/sports/soccer/${leagueId}/summary?event=${eventId}`;
}

export function teamScheduleUrl(leagueId: string, teamId: string): string {
  return `${ESPN_BASE}/site/v2/sports/soccer/${leagueId}/teams/${teamId}/schedule`;
}

export function teamRosterUrl(leagueId: string, teamId: string): string {
  return `${ESPN_BASE}/site/v2/sports/soccer/${leagueId}/teams/${teamId}?enable=roster`;
}

export function standingsUrl(leagueId: string): string {
  return `${ESPN_BASE}/v2/sports/soccer/${leagueId}/standings`;
}

export type FetchScoreboardRangeOpts = {
  /** Paus mellan ESPN-fönster (rate limit, t.ex. backfill). */
  delayMs?: number;
  onWindowError?: (winStart: string, winEnd: string, err: unknown) => void;
};

/** Hämtar scoreboard i 28-dagarsfönster (ESPN max ~30 dagar per anrop). */
export async function fetchScoreboardRange(
  leagueId: string,
  fromYmd: string,
  toYmd: string,
  opts?: FetchScoreboardRangeOpts,
): Promise<any[]> {
  const events: any[] = [];
  const seen = new Set<string>();
  const start = new Date(
    `${fromYmd.slice(0, 4)}-${fromYmd.slice(4, 6)}-${fromYmd.slice(6, 8)}T00:00:00Z`,
  );
  const end = new Date(
    `${toYmd.slice(0, 4)}-${toYmd.slice(4, 6)}-${toYmd.slice(6, 8)}T00:00:00Z`,
  );
  let cursor = new Date(start);
  while (cursor <= end) {
    const winStart = espnYmd(cursor);
    const next = new Date(cursor.getTime() + 28 * 86400_000);
    const winEnd = espnYmd(next > end ? end : next);
    try {
      const data: any = await espnGet(scoreboardUrl(leagueId, winStart, winEnd));
      for (const e of data?.events ?? []) {
        const id = String(e.id);
        if (!seen.has(id)) {
          seen.add(id);
          events.push(e);
        }
      }
    } catch (err) {
      opts?.onWindowError?.(winStart, winEnd, err);
    }
    if (opts?.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
    cursor = new Date(next.getTime() + 86400_000);
  }
  return events;
}

/** Hämta events från scoreboard för ett tidsfönster (ms). */
export async function fetchScoreboardWindow(
  leagueId: string,
  fromMs: number,
  toMs: number,
): Promise<any[]> {
  const from = espnYmd(new Date(fromMs));
  const to = espnYmd(new Date(toMs));
  const data: any = await espnGet(scoreboardUrl(leagueId, from, to));
  return data?.events ?? [];
}
