import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  ESPN_BASE,
  espnGet,
  espnYmd,
  scoreboardUrl,
  standingsUrl,
} from "./espn.api";

export { LEAGUES } from "./leagues";
import { LEAGUES } from "./leagues";


type LeagueSlug = (typeof LEAGUES)[number]["id"];

// Bygger en map teamId -> antal spelade matcher från ESPN-standings.
// Används för att räkna ut omgångsnummer när ESPN inte ger week.number (t.ex. Allsvenskan).
async function getTeamPlayedMap(leagueId: string): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  try {
    const s: any = await espnGet(`${ESPN_BASE}/v2/sports/soccer/${leagueId}/standings`);
    const entries: any[] =
      s?.children?.[0]?.standings?.entries ?? s?.standings?.entries ?? [];
    for (const e of entries) {
      const id = String(e.team?.id ?? "");
      const played = Number(
        e.stats?.find((x: any) => x.name === "gamesPlayed" || x.type === "gamesPlayed")?.value,
      );
      if (id && Number.isFinite(played)) map.set(id, played);
    }
  } catch {
    /* tysta */
  }
  return map;
}

// Räknar ut omgångsnummer för en match baserat på lagens spelade matcher.
// Hemmalaget har vanligtvis spelat samma antal som bortalaget innan rundan.
function computeRound(
  homeId: string,
  awayId: string,
  played: Map<string, number>,
  state: string | undefined,
): number | null {
  const h = played.get(homeId);
  const a = played.get(awayId);
  if (h == null && a == null) return null;
  // För kommande matcher = min(played) + 1. För spelade = max(played).
  if (state === "post") return Math.max(h ?? 0, a ?? 0);
  const base = Math.min(h ?? Infinity, a ?? Infinity);
  return Number.isFinite(base) ? base + 1 : null;
}

// ----- Full upcoming round (next 10 days) + live across our leagues -----
export const getTodayMatches = createServerFn({ method: "GET" }).handler(
  async () => {
    const from = espnYmd(new Date());
    const to = espnYmd(new Date(Date.now() + 3 * 86400_000));
    const results = await Promise.all(
      LEAGUES.map(async (lg) => {
        const [data, played]: [any, Map<string, number>] = await Promise.all([
          espnGet(`${ESPN_BASE}/site/v2/sports/soccer/${lg.id}/scoreboard?dates=${from}-${to}`).catch(() => null),
          getTeamPlayedMap(lg.id),
        ]);
        const matches = (data?.events ?? []).map((e: any) => {
          const comp = e.competitions?.[0];
          const home = comp?.competitors?.find((c: any) => c.homeAway === "home");
          const away = comp?.competitors?.find((c: any) => c.homeAway === "away");
          const status = e.status ?? comp?.status;
          const homeId = String(home?.team?.id ?? "");
          const awayId = String(away?.team?.id ?? "");
          const state = status?.type?.state as string | undefined;
          const espnRound = e.week?.number ?? e.season?.week ?? null;
          return {
            id: String(e.id),
            leagueId: lg.id,
            homeId,
            awayId,
            home: home?.team?.displayName,
            homeShort: home?.team?.shortDisplayName,
            homeLogo: home?.team?.logo,
            away: away?.team?.displayName,
            awayShort: away?.team?.shortDisplayName,
            awayLogo: away?.team?.logo,
            homeScore: home?.score != null ? Number(home.score) : null,
            awayScore: away?.score != null ? Number(away.score) : null,
            state,
            detail: status?.type?.shortDetail,
            clock: status?.displayClock,
            utcTime: e.date,
            round: espnRound ?? computeRound(homeId, awayId, played, state),
          };
        });
        return { id: lg.id, name: lg.name, matches };
      }),
    );
    return { date: new Date().toISOString(), leagues: results };
  },
);

// ----- Next round (matchweek) across our leagues -----
export const getNextRound = createServerFn({ method: "GET" }).handler(
  async () => {
    const from = espnYmd(new Date());
    const to = espnYmd(new Date(Date.now() + 21 * 86400_000));
    const results = await Promise.all(
      LEAGUES.map(async (lg) => {
        const [data, played]: [any, Map<string, number>] = await Promise.all([
          espnGet(`${ESPN_BASE}/site/v2/sports/soccer/${lg.id}/scoreboard?dates=${from}-${to}`).catch(() => null),
          getTeamPlayedMap(lg.id),
        ]);
        const events: any[] = data?.events ?? [];
        // Endast matcher som inte startat
        const pre = events
          .filter((e) => e.status?.type?.state === "pre")
          .sort((a, b) => +new Date(a.date) - +new Date(b.date));
        if (pre.length === 0) {
          return { id: lg.id, name: lg.name, round: null as number | null, matches: [] as any[] };
        }
        // Hitta omgångsnummer från första kommande matchen, annars från standings
        const firstHomeId = String(
          pre[0].competitions?.[0]?.competitors?.find((c: any) => c.homeAway === "home")?.team?.id ?? "",
        );
        const firstAwayId = String(
          pre[0].competitions?.[0]?.competitors?.find((c: any) => c.homeAway === "away")?.team?.id ?? "",
        );
        const firstWeek =
          pre[0].week?.number ??
          pre[0].season?.week ??
          computeRound(firstHomeId, firstAwayId, played, "pre");

        let roundEvents: any[];
        if (firstWeek != null) {
          roundEvents = pre.filter((e) => {
            const espnW = e.week?.number ?? e.season?.week;
            if (espnW != null) return espnW === firstWeek;
            const hId = String(
              e.competitions?.[0]?.competitors?.find((c: any) => c.homeAway === "home")?.team?.id ?? "",
            );
            const aId = String(
              e.competitions?.[0]?.competitors?.find((c: any) => c.homeAway === "away")?.team?.id ?? "",
            );
            return computeRound(hId, aId, played, "pre") === firstWeek;
          });
        } else {
          // Fallback: gruppera per ISO-vecka av första matchens datum
          const first = new Date(pre[0].date);
          const weekKey = (d: Date) => {
            const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
            const day = t.getUTCDay() || 7;
            t.setUTCDate(t.getUTCDate() + 4 - day);
            const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
            return `${t.getUTCFullYear()}-${Math.ceil(((+t - +yearStart) / 86400000 + 1) / 7)}`;
          };
          const target = weekKey(first);
          roundEvents = pre.filter((e) => weekKey(new Date(e.date)) === target);
        }

        const matches = roundEvents.map((e: any) => {
          const comp = e.competitions?.[0];
          const home = comp?.competitors?.find((c: any) => c.homeAway === "home");
          const away = comp?.competitors?.find((c: any) => c.homeAway === "away");
          const status = e.status ?? comp?.status;
          const homeId = String(home?.team?.id ?? "");
          const awayId = String(away?.team?.id ?? "");
          return {
            id: String(e.id),
            leagueId: lg.id,
            homeId,
            awayId,
            home: home?.team?.displayName,
            homeShort: home?.team?.shortDisplayName,
            homeLogo: home?.team?.logo,
            away: away?.team?.displayName,
            awayShort: away?.team?.shortDisplayName,
            awayLogo: away?.team?.logo,
            homeScore: null,
            awayScore: null,
            state: status?.type?.state,
            detail: status?.type?.shortDetail,
            clock: null,
            utcTime: e.date,
            round:
              e.week?.number ??
              e.season?.week ??
              computeRound(homeId, awayId, played, "pre") ??
              firstWeek ??
              null,
          };
        });

        return { id: lg.id, name: lg.name, round: firstWeek, matches };
      }),
    );
    return { leagues: results };
  },
);

// ----- Lineups (startelvor) — ESPN summary för alla ligor -----
export const getLineups = createServerFn({ method: "GET" })
  .inputValidator((d: { eventId: string; leagueId: string; home?: string; away?: string; utcTime?: string }) =>
    z
      .object({
        eventId: z.string().min(1),
        leagueId: z.string().min(1),
        home: z.string().optional(),
        away: z.string().optional(),
        utcTime: z.string().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const summary: any = await espnGet(
      `${ESPN_BASE}/site/v2/sports/soccer/${data.leagueId}/summary?event=${data.eventId}`,
    ).catch(() => null);
    const rosters: any[] = summary?.rosters ?? [];
    if (rosters.length === 0) return { released: false, home: null, away: null };

    const mapSide = (side: any) => {
      const roster: any[] = side?.roster ?? [];
      const starters = roster
        .filter((p) => p.starter)
        .map((p) => ({
          id: String(p.athlete?.id ?? ""),
          name: p.athlete?.displayName ?? p.athlete?.fullName ?? "",
          jersey: p.jersey ?? null,
          position: p.position?.abbreviation ?? p.position?.displayName ?? null,
        }));
      const bench = roster
        .filter((p) => !p.starter)
        .map((p) => ({
          id: String(p.athlete?.id ?? ""),
          name: p.athlete?.displayName ?? p.athlete?.fullName ?? "",
          jersey: p.jersey ?? null,
          position: p.position?.abbreviation ?? p.position?.displayName ?? null,
        }));
      return {
        teamId: String(side?.team?.id ?? ""),
        teamName: side?.team?.displayName ?? "",
        formation: side?.formation ?? null,
        starters,
        bench,
      };
    };

    const home = mapSide(rosters.find((r) => r.homeAway === "home") ?? rosters[0]);
    const away = mapSide(rosters.find((r) => r.homeAway === "away") ?? rosters[1]);
    const released = home.starters.length >= 10 && away.starters.length >= 10;
    return { released, home, away };
  });

// ----- League standings + top scorers + upcoming -----
export const getLeague = createServerFn({ method: "GET" })
  .inputValidator((d: { id: string }) =>
    z.object({ id: z.string().min(1) }).parse(d),
  )
  .handler(async ({ data }) => {
    const slug = data.id as LeagueSlug;

    const [standingsRaw, scoreboardRaw, leadersRaw] = await Promise.all([
      espnGet(`${ESPN_BASE}/v2/sports/soccer/${slug}/standings`).catch(() => null),
      espnGet(`${ESPN_BASE}/site/v2/sports/soccer/${slug}/scoreboard`).catch(() => null),
      espnGet(`${ESPN_BASE}/common/v3/sports/soccer/${slug}/leaders`).catch(() => null),
    ]);

    // Standings — ESPN returnerar grupper i children[]. Slå ihop alla med gruppnamn.
    const childrenArr: any[] = (standingsRaw as any)?.children ?? [];
    const groupEntries: { group: string | null; entries: any[] }[] =
      childrenArr.length > 0
        ? childrenArr.map((c: any) => ({
            group: c?.name ?? c?.displayName ?? null,
            entries: c?.standings?.entries ?? [],
          }))
        : [{ group: null, entries: (standingsRaw as any)?.standings?.entries ?? [] }];

    const stat = (e: any, name: string) =>
      e.stats?.find((s: any) => s.name === name || s.type === name)?.value ??
      e.stats?.find((s: any) => s.name === name || s.type === name)
        ?.displayValue ??
      "-";

    const standings = groupEntries.flatMap(({ group, entries }) =>
      entries.map((e: any, idx: number) => {
        const played = Number(stat(e, "gamesPlayed")) || 0;
        const wins = Number(stat(e, "wins")) || 0;
        const draws = Number(stat(e, "ties")) || 0;
        const gf = Number(stat(e, "pointsFor")) || 0;
        const ga = Number(stat(e, "pointsAgainst")) || 0;
        const gd = gf - ga;
        const pts = Number(stat(e, "points")) || wins * 3 + draws;
        const xPtsPerGame = played
          ? Math.max(0, Math.min(3, 1.35 + 0.7 * (gd / played)))
          : 0;
        const xPts = Math.round(xPtsPerGame * played * 10) / 10;
        const luck = Math.round((pts - xPts) * 10) / 10;
        const name = e.team?.displayName as string;
        return {
          group,
          idx: Number(stat(e, "rank")) || idx + 1,
          teamId: e.team?.id,
          name,
          logo: e.team?.logos?.[0]?.href,
          played,
          wins,
          draws,
          losses: Number(stat(e, "losses")) || 0,
          gf,
          ga,
          goalConDiff: gd > 0 ? `+${gd}` : `${gd}`,
          pts,
          xPts,
          luck,
          xG: null as number | null,
          xGA: null as number | null,
        };
      }),
    );

    // Upcoming — anything that hasn't started yet
    const events: any[] = (scoreboardRaw as any)?.events ?? [];
    const upcoming = events
      .filter((e: any) => e.status?.type?.state === "pre")
      .slice(0, 20)
      .map((e: any) => {
        const comp = e.competitions?.[0];
        const home = comp?.competitors?.find((c: any) => c.homeAway === "home");
        const away = comp?.competitors?.find((c: any) => c.homeAway === "away");
        return {
          id: String(e.id),
          home: home?.team?.displayName,
          away: away?.team?.displayName,
          utcTime: e.date,
        };
      });

    // Leaders → top scorers / assists
    const cats: any[] =
      (leadersRaw as any)?.categories ??
      (leadersRaw as any)?.leaders?.categories ??
      [];
    const findCat = (keys: string[]) =>
      cats.find((c: any) =>
        keys.some(
          (k) =>
            c.name?.toLowerCase().includes(k) ||
            c.displayName?.toLowerCase().includes(k),
        ),
      );

    const mapLeader = (l: any) => ({
      id: l.athlete?.id,
      name: l.athlete?.displayName,
      teamName: l.team?.displayName ?? l.athlete?.team?.displayName,
      teamId: l.team?.id,
      headshot: l.athlete?.headshot?.href,
      value: l.value ?? l.displayValue,
    });

    const topScorers = (findCat(["goal"])?.leaders ?? []).slice(0, 10).map(mapLeader);
    const topAssists = (findCat(["assist"])?.leaders ?? []).slice(0, 10).map(mapLeader);

    return {
      id: slug,
      name:
        (standingsRaw as any)?.name ??
        LEAGUES.find((l) => l.id === slug)?.name ??
        slug,
      standings,
      topScorers,
      topAssists,
      upcoming,
    };
  });
