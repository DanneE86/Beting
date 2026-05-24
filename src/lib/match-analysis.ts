import { espnGet, summaryUrl } from "./espn.api";
import {
  computeGoalStats,
  goalStatsForVenue,
  type GoalTrendStats,
  type ScheduleMatchRow,
} from "./form-stats";

export type VenueRecord = {
  played: number;
  wins: number;
  draws: number;
  losses: number;
  points: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDiff: number;
  bttsPct: number | null;
  cleanSheetPct: number | null;
  avgGoalsFor: number | null;
  avgGoalsAgainst: number | null;
};

export type TierResults = {
  played: number;
  wins: number;
  draws: number;
  losses: number;
  points: number;
  goalsFor: number;
  goalsAgainst: number;
};

export type H2HAggregate = {
  meetings: number;
  homeWins: number;
  draws: number;
  homeLosses: number;
  avgTotalGoals: number | null;
  bttsPct: number | null;
  atSameVenue: { meetings: number; avgGoals: number | null };
};

export type MatchAnalysisSections = {
  grundlaggande: string;
  btts: string;
  oneXtwo: string;
  h2h: string;
  lagnyheter: string;
  ovrigt: string;
};

export type PreMatchChecklistData = {
  homeLast6: { result: string; score: string; opponent?: string; homeAway: string }[];
  awayLast6: { result: string; score: string; opponent?: string; homeAway: string }[];
  homeAtHome: VenueRecord;
  awayOnRoad: VenueRecord;
  homeScoringProfile: "målrik" | "låst" | "balanserad" | "okänd";
  awayScoringProfile: "målrik" | "låst" | "balanserad" | "okänd";
  homeFavoriteRecord: TierResults | null;
  awayAwayVsTop: TierResults | null;
  h2hAggregate: H2HAggregate | null;
  eventMeta: {
    weather: string | null;
    referee: string | null;
    venue: string | null;
    matchNote: string | null;
  } | null;
};

type StandingLite = { teamId: string; rank: number };

export function venueRecord(
  matches: ScheduleMatchRow[],
  side: "home" | "away",
  n = 8,
): VenueRecord {
  const filtered = matches.filter((m) => m.homeAway === side).slice(-n);
  let wins = 0;
  let draws = 0;
  let losses = 0;
  let goalsFor = 0;
  let goalsAgainst = 0;
  let btts = 0;
  let cleanSheets = 0;
  for (const m of filtered) {
    if (m.result === "W") wins++;
    else if (m.result === "D") draws++;
    else losses++;
    goalsFor += m.usScore;
    goalsAgainst += m.themScore;
    if (m.usScore > 0 && m.themScore > 0) btts++;
    if (m.themScore === 0) cleanSheets++;
  }
  const played = filtered.length;
  return {
    played,
    wins,
    draws,
    losses,
    points: wins * 3 + draws,
    goalsFor,
    goalsAgainst,
    goalDiff: goalsFor - goalsAgainst,
    bttsPct: played ? Math.round((btts / played) * 100) : null,
    cleanSheetPct: played ? Math.round((cleanSheets / played) * 100) : null,
    avgGoalsFor: played ? Math.round((goalsFor / played) * 100) / 100 : null,
    avgGoalsAgainst: played ? Math.round((goalsAgainst / played) * 100) / 100 : null,
  };
}

export function scoringProfile(
  stats: GoalTrendStats | null,
  venue?: { avgGoalsFor: number; avgGoalsAgainst: number } | null,
): "målrik" | "låst" | "balanserad" | "okänd" {
  const avgFor = venue?.avgGoalsFor ?? stats?.avgGoalsFor;
  const avgAgainst = venue?.avgGoalsAgainst ?? stats?.avgGoalsAgainst;
  const over25 = stats?.over25Pct;
  if (avgFor == null || avgAgainst == null) return "okänd";
  const total = avgFor + avgAgainst;
  if ((over25 != null && over25 >= 58) || total >= 3.15) return "målrik";
  if ((over25 != null && over25 <= 38) || total <= 2.15) return "låst";
  return "balanserad";
}

function tierBounds(teamCount: number) {
  const topCut = Math.max(1, Math.ceil(teamCount / 3));
  const bottomStart = Math.max(topCut + 1, teamCount - topCut + 1);
  return { topCut, bottomStart };
}

export function resultsVsOpponentTier(
  matches: ScheduleMatchRow[],
  standings: StandingLite[],
  tier: "top" | "mid" | "bottom",
  n = 10,
): TierResults | null {
  if (standings.length < 6) return null;
  const { topCut, bottomStart } = tierBounds(standings.length);
  const rankById = new Map(standings.map((s) => [s.teamId, s.rank]));
  const filtered = matches.slice(-n).filter((m) => {
    const rank = m.opponentId ? rankById.get(m.opponentId) : undefined;
    if (rank == null) return false;
    if (tier === "top") return rank <= topCut;
    if (tier === "bottom") return rank >= bottomStart;
    return rank > topCut && rank < bottomStart;
  });
  if (!filtered.length) return null;
  let wins = 0;
  let draws = 0;
  let losses = 0;
  let goalsFor = 0;
  let goalsAgainst = 0;
  for (const m of filtered) {
    if (m.result === "W") wins++;
    else if (m.result === "D") draws++;
    else losses++;
    goalsFor += m.usScore;
    goalsAgainst += m.themScore;
  }
  return {
    played: filtered.length,
    wins,
    draws,
    losses,
    points: wins * 3 + draws,
    goalsFor,
    goalsAgainst,
  };
}

/** Hemma som tabellfavorit (bättre placerat än motståndaren) eller borta mot topplag. */
export function favoriteSituationRecord(
  matches: ScheduleMatchRow[],
  standings: StandingLite[],
  ownTeamId: string,
  mode: "home_favorite" | "away_vs_top",
): TierResults | null {
  const own = standings.find((s) => s.teamId === ownTeamId);
  if (!own || standings.length < 6) return null;
  const { topCut } = tierBounds(standings.length);
  const rankById = new Map(standings.map((s) => [s.teamId, s.rank]));
  const filtered = matches.slice(-12).filter((m) => {
    const oppRank = m.opponentId ? rankById.get(m.opponentId) : undefined;
    if (oppRank == null) return false;
    if (mode === "home_favorite") {
      return m.homeAway === "home" && own.rank < oppRank;
    }
    return m.homeAway === "away" && oppRank <= topCut;
  });
  if (!filtered.length) return null;
  let wins = 0;
  let draws = 0;
  let losses = 0;
  let goalsFor = 0;
  let goalsAgainst = 0;
  for (const m of filtered) {
    if (m.result === "W") wins++;
    else if (m.result === "D") draws++;
    else losses++;
    goalsFor += m.usScore;
    goalsAgainst += m.themScore;
  }
  return {
    played: filtered.length,
    wins,
    draws,
    losses,
    points: wins * 3 + draws,
    goalsFor,
    goalsAgainst,
  };
}

export function aggregateH2H(
  h2h: { result: string; score: string; venue: string }[],
  homeVenue: "home" | "away" = "home",
): H2HAggregate | null {
  if (!h2h.length) return null;
  let homeWins = 0;
  let draws = 0;
  let homeLosses = 0;
  let totalGoals = 0;
  let btts = 0;
  const atVenue: { goals: number[] } = { goals: [] };
  for (const m of h2h) {
    const [a, b] = m.score.split("-").map(Number);
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    totalGoals += a + b;
    if (a > 0 && b > 0) btts++;
    if (m.result === "W") homeWins++;
    else if (m.result === "D") draws++;
    else homeLosses++;
    if (m.venue === homeVenue) atVenue.goals.push(a + b);
  }
  const n = h2h.length;
  return {
    meetings: n,
    homeWins,
    draws,
    homeLosses,
    avgTotalGoals: n ? Math.round((totalGoals / n) * 100) / 100 : null,
    bttsPct: n ? Math.round((btts / n) * 100) : null,
    atSameVenue: {
      meetings: atVenue.goals.length,
      avgGoals: atVenue.goals.length
        ? Math.round((atVenue.goals.reduce((s, g) => s + g, 0) / atVenue.goals.length) * 100) /
          100
        : null,
    },
  };
}

export async function fetchEventMeta(leagueId: string, eventId: string) {
  try {
    const summary: any = await espnGet(summaryUrl(leagueId, eventId));
    const comp = summary?.header?.competitions?.[0] ?? summary?.gameInfo;
    const weather =
      summary?.gameInfo?.weather?.displayValue ??
      comp?.weather?.displayValue ??
      comp?.weather?.condition ??
      null;
    const officials: any[] =
      summary?.gameInfo?.officials ?? comp?.officials ?? summary?.boxscore?.officials ?? [];
    const referee =
      officials.find(
        (o) =>
          /referee|domare/i.test(o?.position?.name ?? o?.position?.abbreviation ?? "") ||
          o?.order === 1,
      )?.displayName ??
      officials[0]?.displayName ??
      null;
    const venue =
      summary?.gameInfo?.venue?.fullName ??
      comp?.venue?.fullName ??
      summary?.gameInfo?.venue?.address?.city ??
      null;
    const matchNote = comp?.notes?.[0]?.headline ?? comp?.notes?.[0]?.type ?? null;
    return {
      weather: weather ? String(weather) : null,
      referee: referee ? String(referee) : null,
      venue: venue ? String(venue) : null,
      matchNote: matchNote ? String(matchNote) : null,
    };
  } catch {
    return null;
  }
}

function fmtVenue(v: VenueRecord, label: string) {
  if (!v.played) return `${label}: för få matcher på plats.`;
  return (
    `${label} (senaste ${v.played}): ${v.wins}V-${v.draws}O-${v.losses}F, ` +
    `${v.points} p, mål ${v.goalsFor}-${v.goalsAgainst} (GD ${v.goalDiff >= 0 ? "+" : ""}${v.goalDiff}), ` +
    `snitt ${v.avgGoalsFor}/${v.avgGoalsAgainst} för/emot, BTTS ${v.bttsPct ?? "—"}%, nolla ${v.cleanSheetPct ?? "—"}%.`
  );
}

function fmtTier(label: string, t: TierResults | null) {
  if (!t?.played) return `${label}: otillräcklig data.`;
  const wr = Math.round((t.wins / t.played) * 100);
  return `${label} (${t.played} matcher): ${t.wins}V-${t.draws}O-${t.losses}F (${wr}% vinster), mål ${t.goalsFor}-${t.goalsAgainst}.`;
}

export function buildPreMatchChecklistData(input: {
  homeSchedule: ScheduleMatchRow[];
  awaySchedule: ScheduleMatchRow[];
  homeTeamId: string;
  awayTeamId: string;
  standings: StandingLite[];
  h2h: { result: string; score: string; venue: string }[];
  homeGoalStats: GoalTrendStats | null;
  awayGoalStats: GoalTrendStats | null;
  eventMeta: PreMatchChecklistData["eventMeta"];
}): PreMatchChecklistData {
  const homeVenueStats = goalStatsForVenue(input.homeSchedule, "home");
  const awayVenueStats = goalStatsForVenue(input.awaySchedule, "away");
  return {
    homeLast6: input.homeSchedule.slice(-6).map((m) => ({
      result: m.result,
      score: m.score,
      opponent: m.opponent,
      homeAway: m.homeAway,
    })),
    awayLast6: input.awaySchedule.slice(-6).map((m) => ({
      result: m.result,
      score: m.score,
      opponent: m.opponent,
      homeAway: m.homeAway,
    })),
    homeAtHome: venueRecord(input.homeSchedule, "home"),
    awayOnRoad: venueRecord(input.awaySchedule, "away"),
    homeScoringProfile: scoringProfile(input.homeGoalStats, homeVenueStats),
    awayScoringProfile: scoringProfile(input.awayGoalStats, awayVenueStats),
    homeFavoriteRecord: favoriteSituationRecord(
      input.homeSchedule,
      input.standings,
      input.homeTeamId,
      "home_favorite",
    ),
    awayAwayVsTop: favoriteSituationRecord(
      input.awaySchedule,
      input.standings,
      input.awayTeamId,
      "away_vs_top",
    ),
    h2hAggregate: aggregateH2H(input.h2h),
    eventMeta: input.eventMeta,
  };
}

export function buildTemplateMatchAnalysis(input: {
  homeName: string;
  awayName: string;
  checklist: PreMatchChecklistData;
  homeGoalStats: GoalTrendStats | null;
  awayGoalStats: GoalTrendStats | null;
  homeStanding?: { rank: number; pts: number; gf: number; ga: number };
  awayStanding?: { rank: number; pts: number; gf: number; ga: number };
  seasonContext?: {
    home: { stakeLabel: string; rank: number };
    away: { stakeLabel: string; rank: number };
    motivatedSide?: string | null;
  } | null;
  marketOdds?: {
    marketProbPct: { home: number; draw: number; away: number };
    decimalOdds: { home: number | null; draw: number | null; away: number | null };
  } | null;
  modelPct?: { home: number; draw: number; away: number };
  homeAbsenceScore?: number;
  awayAbsenceScore?: number;
  keyAbsencesHome?: string[];
  keyAbsencesAway?: string[];
  lineupReleased?: boolean;
}): MatchAnalysisSections {
  const {
    homeName,
    awayName,
    checklist: c,
    homeGoalStats,
    awayGoalStats,
    homeStanding,
    awayStanding,
    seasonContext,
    marketOdds,
    modelPct,
  } = input;

  const formStr = (name: string, rows: PreMatchChecklistData["homeLast6"]) =>
    rows.length
      ? `${name}: ${rows.map((m) => `${m.result} ${m.score} (${m.homeAway === "home" ? "H" : "B"})`).join(", ")}`
      : `${name}: form saknas`;

  const grundlaggande = [
    formStr(homeName, c.homeLast6),
    formStr(awayName, c.awayLast6),
    fmtVenue(c.homeAtHome, `${homeName} hemma`),
    fmtVenue(c.awayOnRoad, `${awayName} borta`),
    homeGoalStats
      ? `${homeName} snitt (10 matcher): ${homeGoalStats.avgGoalsFor} gjorda / ${homeGoalStats.avgGoalsAgainst} insläppta, över 2.5 i ${homeGoalStats.over25Pct}%`
      : null,
    awayGoalStats
      ? `${awayName} snitt (10 matcher): ${awayGoalStats.avgGoalsFor} gjorda / ${awayGoalStats.avgGoalsAgainst} insläppta, över 2.5 i ${awayGoalStats.over25Pct}%`
      : null,
    `Matchprofil: ${homeName} ${c.homeScoringProfile}, ${awayName} ${c.awayScoringProfile}.`,
  ]
    .filter(Boolean)
    .join(" ");

  const btts = [
    homeGoalStats
      ? `${homeName} BTTS ${homeGoalStats.bttsPct}% (senaste 10), nolla ${homeGoalStats.cleanSheets} matcher, missat mål ${homeGoalStats.failedToScore}`
      : null,
    awayGoalStats
      ? `${awayName} BTTS ${awayGoalStats.bttsPct}% (senaste 10), nolla ${awayGoalStats.cleanSheets} matcher, missat mål ${awayGoalStats.failedToScore}`
      : null,
    c.homeAtHome.bttsPct != null ? `${homeName} hemma BTTS ${c.homeAtHome.bttsPct}%` : null,
    c.awayOnRoad.bttsPct != null ? `${awayName} borta BTTS ${c.awayOnRoad.bttsPct}%` : null,
    c.homeAtHome.cleanSheetPct != null
      ? `Hemma nolla ${c.homeAtHome.cleanSheetPct}% · borta nolla ${c.awayOnRoad.cleanSheetPct ?? "—"}%`
      : null,
  ]
    .filter(Boolean)
    .join(". ");

  const oneXtwo = [
    homeStanding && awayStanding
      ? `Tabell: ${homeName} #${homeStanding.rank} (${homeStanding.pts} p, ${homeStanding.gf}-${homeStanding.ga}) vs ${awayName} #${awayStanding.rank} (${awayStanding.pts} p, ${awayStanding.gf}-${awayStanding.ga})`
      : null,
    seasonContext
      ? `Insats: ${homeName} ${seasonContext.home.stakeLabel}, ${awayName} ${seasonContext.away.stakeLabel}${seasonContext.motivatedSide ? ` — extra motivation: ${seasonContext.motivatedSide === "home" ? homeName : awayName}` : ""}`
      : null,
    fmtTier(`${homeName} vinner som hemmafavorit`, c.homeFavoriteRecord),
    fmtTier(`${awayName} tar poäng borta mot topplag`, c.awayAwayVsTop),
    modelPct
      ? `Modell: 1 ${Math.round(modelPct.home)}% · X ${Math.round(modelPct.draw)}% · 2 ${Math.round(modelPct.away)}%`
      : null,
  ]
    .filter(Boolean)
    .join(". ");

  const h2h = c.h2hAggregate
    ? `Inbördes (${c.h2hAggregate.meetings} möten): ${homeName} ${c.h2hAggregate.homeWins}V-${c.h2hAggregate.draws}O-${c.h2hAggregate.homeLosses}F ur hemmalagets perspektiv. Snitt ${c.h2hAggregate.avgTotalGoals ?? "—"} mål/match, BTTS ${c.h2hAggregate.bttsPct ?? "—"}%. På samma arena (${c.h2hAggregate.atSameVenue.meetings} st): snitt ${c.h2hAggregate.atSameVenue.avgGoals ?? "—"} mål.`
    : "Ingen nylig inbördes-historik i datan.";

  const lagnyheter = [
    input.lineupReleased ? "Officiella startelvor släppta." : "Startelvor ej släppta ännu.",
    input.keyAbsencesHome?.length
      ? `${homeName} nyckelavbräck: ${input.keyAbsencesHome.slice(0, 4).join(", ")}`
      : `${homeName}: inga tunga avbräck i datan`,
    input.keyAbsencesAway?.length
      ? `${awayName} nyckelavbräck: ${input.keyAbsencesAway.slice(0, 4).join(", ")}`
      : `${awayName}: inga tunga avbräck i datan`,
    (input.homeAbsenceScore ?? 0) > 4 || (input.awayAbsenceScore ?? 0) > 4
      ? `AbsenceScore H ${input.homeAbsenceScore ?? 0} / B ${input.awayAbsenceScore ?? 0} — väg försvar/anfall tungt.`
      : null,
  ]
    .filter(Boolean)
    .join(" ");

  const ovrigt = [
    c.eventMeta?.weather ? `Väder: ${c.eventMeta.weather}` : null,
    c.eventMeta?.referee ? `Domare: ${c.eventMeta.referee}` : null,
    c.eventMeta?.venue ? `Arena: ${c.eventMeta.venue}` : null,
    c.eventMeta?.matchNote ? `Matchkontext: ${c.eventMeta.matchNote}` : null,
    marketOdds
      ? `Marknad: 1 ${marketOdds.decimalOdds.home?.toFixed(2) ?? "—"} (${marketOdds.marketProbPct.home}%) · X ${marketOdds.decimalOdds.draw?.toFixed(2) ?? "—"} (${marketOdds.marketProbPct.draw}%) · 2 ${marketOdds.decimalOdds.away?.toFixed(2) ?? "—"} (${marketOdds.marketProbPct.away}%)`
      : "Marknadsodds saknas — jämför manuellt mot modellen.",
    modelPct && marketOdds
      ? `Modell vs marknad (1): ${(modelPct.home - marketOdds.marketProbPct.home).toFixed(1)}%-enheter`
      : null,
  ]
    .filter(Boolean)
    .join(". ");

  return { grundlaggande, btts, oneXtwo, h2h, lagnyheter, ovrigt };
}
