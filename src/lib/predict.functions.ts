import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { LEAGUES } from "./fotmob.functions";
import { fetchAllsvenskanAdvanced, findBolldataRow } from "./bolldata.functions";
import { getTransfermarktInjuries } from "./injuries.functions";
import { fetchMatchdaySquad, type MatchdaySquad } from "./squads.functions";
import {
  savePrediction,
  getCalibration,
  buildCalibrationHint,
  type LeagueCalibration,
} from "./learning.server";
import {
  getLeagueArchiveStats,
  getLeagueModelParams,
  getTeamArchiveRatings,
  type LeagueModelParams,
  type TeamArchiveRatings,
} from "./league-ratings.server";
import type { OptaMatch } from "./opta.scraper";
import { findOptaMatch, formatOptaMatchSummary } from "./opta.utils";
import { getCachedOptaMatches } from "./opta.server";
import { applyProBettorAdjustments, buildProBettingAdvice } from "./pro-bettor-model";
import { predictBtts } from "./btts-model";
import { calibrationToAdjustments } from "./calibration";
import {
  espnGet,
  espnYmd,
  scoreboardUrl,
  standingsUrl,
  summaryUrl,
  teamRosterUrl,
  teamScheduleUrl,
} from "./espn.api";
import {
  buildH2H,
  computeGoalStats,
  daysSinceLast,
  goalStatsForVenue,
  homeAwaySplitForm,
  type ScheduleMatchRow,
} from "./form-stats";
import { outcomeToTip } from "./match-outcome";
import {
  DEFAULT_CFG,
  LEAGUE_END_CFG,
  resolveMotivationAsymmetry,
  stakeForTeam,
  stakeLabelSv,
  type SeasonStakes,
} from "./season-stakes";
import {
  applyCalibrationAdjustments,
  blendWithMarket,
  deriveConfidence,
  fixBttsScoreCoherence,
  fixScoreCoherence,
  pickOutcome,
  poissonMatchPrediction,
  resolvePredictedScore,
} from "./poisson-model";
import {
  buildBttsAnalysisSection,
  buildPreMatchChecklistData,
  buildTemplateMatchAnalysis,
  ensureMatchAnalysisBtts,
  fetchEventMeta,
  type MatchAnalysisSections,
} from "./match-analysis";
import { getModelPromptText } from "./model-prompts.server";
import { getLeaguePromptText } from "./prompts.functions";

async function teamRoster(leagueSlug: string, teamId: string) {
  try {
    const data: any = await espnGet(teamRosterUrl(leagueSlug, teamId));
    const ath: any[] = data?.team?.athletes ?? [];
    return ath.map((a) => ({
      name: a.displayName,
      pos:
        (typeof a.position === "object" && a.position?.abbreviation) ||
        a.position ||
        "?",
      jersey: a.jersey,
      injured:
        Array.isArray(a.injuries) && a.injuries.length > 0
          ? a.injuries[0]?.status ?? "skadad"
          : null,
    }));
  } catch {
    return [];
  }
}

type RosterPlayer = Awaited<ReturnType<typeof teamRoster>>[number];
type ConfirmedInjury = Awaited<ReturnType<typeof getTransfermarktInjuries>>["injuries"][number];

function normalizeName(name: string) {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function buildKeyAbsenceReport(
  roster: RosterPlayer[],
  confirmedInjuries: ConfirmedInjury[],
  missingFromMatchday: string[],
  lineupReleased: boolean,
) {
  const injuryByName = new Map(
    confirmedInjuries.map((injury) => [normalizeName(injury.name), injury]),
  );
  const missingSet = new Set(missingFromMatchday.map(normalizeName));
  const posWeight: Record<string, number> = { G: 3.4, D: 1.5, M: 2.1, F: 2.8 };

  const ranked = roster
    .map((player) => {
      const key = normalizeName(player.name);
      const injury = injuryByName.get(key);
      const missing = missingSet.has(key);
      let score = posWeight[player.pos] ?? 1;

      if (injury) {
        score += 1.8;
        if ((injury.missedMatches ?? 0) >= 5) score += 1.2;
        else if ((injury.missedMatches ?? 0) >= 2) score += 0.7;
        if (injury.until) score += 0.35;
      }

      if (lineupReleased && missing) score += 1.5;
      if (player.injured) score += 0.5;

      return {
        name: player.name,
        pos: player.pos,
        score: Math.round(score * 10) / 10,
        status: injury
          ? `${injury.reason}${injury.until ? `, borta till ${injury.until}` : ""}`
          : missing
            ? "utanför matchtrupp"
            : player.injured || "tillgänglig",
        isMissing: missing,
        isConfirmedInjury: Boolean(injury),
      };
    })
    .filter((player) => player.isMissing || player.isConfirmedInjury || player.score >= 3.4)
    .sort((a, b) => b.score - a.score);

  const keyAbsences = ranked.filter((player) => player.isMissing || player.isConfirmedInjury).slice(0, 5);
  const missingByPos = keyAbsences.reduce(
    (acc, player) => {
      acc[player.pos] = (acc[player.pos] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );

  return {
    keyAbsences,
    absenceScore: Math.round(keyAbsences.reduce((sum, player) => sum + player.score, 0) * 10) / 10,
    missingByPos,
  };
}

async function teamScheduleAll(leagueSlug: string, teamId: string): Promise<ScheduleMatchRow[]> {
  try {
    const data: any = await espnGet(teamScheduleUrl(leagueSlug, teamId));
    const events: any[] = data?.events ?? data?.team?.previousSchedule ?? [];
    const finished = events.filter((e) => e.status?.type?.completed);
    return finished.map((e) => {
      const comp = e.competitions?.[0];
      const us = comp?.competitors?.find((c: any) => c.team?.id === teamId);
      const them = comp?.competitors?.find((c: any) => c.team?.id !== teamId);
      const usScore = Number(us?.score ?? 0);
      const themScore = Number(them?.score ?? 0);
      const result = usScore > themScore ? "W" : usScore < themScore ? "L" : "D";
      return {
        result: result as "W" | "D" | "L",
        score: `${usScore}-${themScore}`,
        opponent: them?.team?.displayName,
        homeAway: us?.homeAway as "home" | "away",
        usScore,
        themScore,
        date: e.date,
        opponentId: them?.team?.id,
      };
    });
  } catch {
    return [];
  }
}

async function getMarketOdds(leagueSlug: string, eventId: string) {
  try {
    const summary: any = await espnGet(summaryUrl(leagueSlug, eventId));
    const pc: any[] = summary?.pickcenter ?? [];
    if (!pc.length) return null;
    // Average across providers
    const homeOdds = pc.map((p) => Number(p?.homeTeamOdds?.moneyLine)).filter((n) => Number.isFinite(n) && n !== 0);
    const drawOdds = pc.map((p) => Number(p?.drawOdds?.moneyLine)).filter((n) => Number.isFinite(n) && n !== 0);
    const awayOdds = pc.map((p) => Number(p?.awayTeamOdds?.moneyLine)).filter((n) => Number.isFinite(n) && n !== 0);
    const toDec = (ml: number) => (ml > 0 ? ml / 100 + 1 : 100 / Math.abs(ml) + 1);
    const avg = (arr: number[]) =>
      arr.length ? Math.round((arr.reduce((s, x) => s + toDec(x), 0) / arr.length) * 100) / 100 : null;
    const dHome = avg(homeOdds);
    const dDraw = avg(drawOdds);
    const dAway = avg(awayOdds);
    if (!dHome || !dDraw || !dAway) return null;
    // Implied prob (with overround removed)
    const iH = 1 / dHome;
    const iD = 1 / dDraw;
    const iA = 1 / dAway;
    const sum = iH + iD + iA;
    return {
      providers: pc.length,
      decimalOdds: { home: dHome, draw: dDraw, away: dAway },
      marketProbPct: {
        home: Math.round((iH / sum) * 1000) / 10,
        draw: Math.round((iD / sum) * 1000) / 10,
        away: Math.round((iA / sum) * 1000) / 10,
      },
    };
  } catch {
    return null;
  }
}

// Fetch official lineup for an upcoming match via ESPN scoreboard + summary.
// Returns starters per side (when released, usually ~1h before kickoff) plus
// a flag indicating if the lineup is confirmed.
async function getLineups(
  leagueSlug: string,
  homeId: string,
  awayId: string,
): Promise<{
  released: boolean;
  source: string;
  home: { starters: string[]; bench: string[] };
  away: { starters: string[]; bench: string[] };
  eventId?: string;
  eventDate?: string;
}> {
  const empty = {
    released: false,
    source: "ESPN",
    home: { starters: [], bench: [] },
    away: { starters: [], bench: [] },
    eventId: undefined as string | undefined,
    eventDate: undefined as string | undefined,
  };
  try {
    // Search ±10 days for the matchup
    const today = new Date();
    const from = new Date(today);
    from.setUTCDate(today.getUTCDate() - 1);
    const to = new Date(today);
    to.setUTCDate(today.getUTCDate() + 10);
    const sb: any = await espnGet(scoreboardUrl(leagueSlug, espnYmd(from), espnYmd(to)));
    const events: any[] = sb?.events ?? [];
    const evt = events.find((e) => {
      const comps = e.competitions?.[0]?.competitors ?? [];
      const ids = comps.map((c: any) => c.team?.id);
      return ids.includes(homeId) && ids.includes(awayId);
    });
    if (!evt) return empty;
    const summary: any = await espnGet(summaryUrl(leagueSlug, evt.id));
    const rosters: any[] = summary?.rosters ?? [];
    const homeR = rosters.find((r) => r.team?.id === homeId);
    const awayR = rosters.find((r) => r.team?.id === awayId);
    const split = (r: any) => {
      const ath: any[] = r?.roster ?? [];
      const starters = ath
        .filter((p) => p.starter === true)
        .map((p) => p.athlete?.displayName)
        .filter(Boolean);
      const bench = ath
        .filter((p) => p.starter === false)
        .map((p) => p.athlete?.displayName)
        .filter(Boolean);
      return { starters, bench };
    };
    const home = homeR ? split(homeR) : { starters: [], bench: [] };
    const away = awayR ? split(awayR) : { starters: [], bench: [] };
    const released = home.starters.length >= 11 && away.starters.length >= 11;
    return { released, source: "ESPN", home, away, eventId: evt.id, eventDate: evt.date };
  } catch {
    return empty;
  }
}

type StandingRow = {
  teamId: string;
  name: string;
  rank: number;
  pts: number;
  played: number;
  gf: number;
  ga: number;
  gd: number;
  xPts: number;
  luck: number;
};

async function leagueStandings(leagueSlug: string): Promise<StandingRow[]> {
  try {
    const data: any = await espnGet(standingsUrl(leagueSlug));
    const entries: any[] = data?.children?.[0]?.standings?.entries ?? [];
    const stat = (e: any, n: string) =>
      e.stats?.find((s: any) => s.name === n || s.type === n)?.value;
    const rows = entries.map((e) => {
      const played = Number(stat(e, "gamesPlayed")) || 0;
      const wins = Number(stat(e, "wins")) || 0;
      const draws = Number(stat(e, "ties")) || 0;
      const losses = Number(stat(e, "losses")) || 0;
      const gf = Number(stat(e, "pointsFor")) || 0;
      const ga = Number(stat(e, "pointsAgainst")) || 0;
      const gd = gf - ga || Number(stat(e, "pointDifferential")) || 0;
      const pts = Number(stat(e, "points")) || wins * 3 + draws;
      // Expected points proxy from goal difference per game.
      // Empirical: each +1 GD/game ≈ ~0.7 extra pts/game over a draw baseline.
      const gdPerGame = played ? gd / played : 0;
      const xPtsPerGame = Math.max(0, Math.min(3, 1.35 + 0.7 * gdPerGame));
      const xPts = Math.round(xPtsPerGame * played * 10) / 10;
      const luck = Math.round((pts - xPts) * 10) / 10; // + = tur, - = otur
      return {
        teamId: e.team?.id as string,
        name: e.team?.displayName as string,
        rank: Number(stat(e, "rank")) || 0,
        pts,
        played,
        gf,
        ga,
        gd,
        xPts,
        luck,
      };
    });
    return rows;
  } catch {
    return [];
  }
}

// ----- Säsongskontext: bara relevant i slutet av säsongen -----
// Returnerar null om det är tidigt/mitt i säsongen — då tas parametern inte med.
function buildSeasonContext(
  standings: StandingRow[],
  homeId: string,
  awayId: string,
  leagueId: string,
) {
  if (standings.length < 6) return null;
  const totalRounds = (standings.length - 1) * 2;
  const maxPlayed = Math.max(...standings.map((s) => s.played));
  const remaining = totalRounds - maxPlayed;
  // Slutet av säsongen = ≤ 6 omgångar kvar
  if (remaining > 6 || remaining < 0) return null;

  const sorted = [...standings].sort((a, b) => a.rank - b.rank);
  const cfg = LEAGUE_END_CFG[leagueId] ?? DEFAULT_CFG;

  const home = sorted.find((s) => s.teamId === homeId);
  const away = sorted.find((s) => s.teamId === awayId);
  if (!home || !away) return null;

  const homeStake = stakeForTeam(home, sorted, cfg, remaining);
  const awayStake = stakeForTeam(away, sorted, cfg, remaining);
  const { asymmetry, motivatedSide } = resolveMotivationAsymmetry(homeStake, awayStake);

  const isLowMotivation = (s: SeasonStakes) =>
    s === "inget-att-spela-for" || s === "cl-säkrad" || s === "europa-säkrad";

  let historicalPattern: string | null = null;
  if (asymmetry && motivatedSide) {
    historicalPattern =
      "Historiskt i europeiska högstaligor: lag som jagar CL/Europa/nedflyttning " +
      "mot motståndare som redan nått sitt mål (CL/Europa säkrad) vinner ~52-58% " +
      "(vs ~45% baseline). Omotiverade toppklubbar roterar ofta trupp sista omgången.";
  } else if (
    (homeStake !== "inget-att-spela-for" && isLowMotivation(awayStake)) ||
    (awayStake !== "inget-att-spela-for" && isLowMotivation(homeStake))
  ) {
    historicalPattern =
      "Asymmetrisk motivation: ett lag har allt att spela för medan motståndaren " +
      "är klart för säsongsmålet — historiskt +5-8% för det motiverade laget.";
  } else if (homeStake === "guld" || awayStake === "guld") {
    historicalPattern =
      "Toppstrid sista omgångarna: laget som jagar guld tenderar att vinna ~60% när motståndaren " +
      "är mid-table utan stakes, men jämna toppmöten oftare slutar X (~30%).";
  } else if (homeStake === "nedflyttning" && awayStake === "nedflyttning") {
    historicalPattern =
      "Direkt bottenmöte (six-pointer): historiskt fler oavgjorda (~32%) och färre mål " +
      "(snitt ~2.1 mål/match vs liga-snitt ~2.7). Nervspel ger ofta lågscoring + X-värde.";
  }

  return {
    roundsRemaining: remaining,
    home: { rank: home.rank, pts: home.pts, stake: homeStake, stakeLabel: stakeLabelSv(homeStake) },
    away: { rank: away.rank, pts: away.pts, stake: awayStake, stakeLabel: stakeLabelSv(awayStake) },
    motivationAsymmetry: asymmetry,
    motivatedSide,
    historicalPattern,
  };
}

const predictMatchInputSchema = z.object({
  leagueId: z.string(),
  homeId: z.string(),
  awayId: z.string(),
  homeName: z.string(),
  awayName: z.string(),
  round: z.number().int().nullable().optional(),
});

function buildStatisticalPrediction(input: {
  homeName: string;
  awayName: string;
  homeStanding?: StandingRow;
  awayStanding?: StandingRow;
  homeForm: { result: string }[];
  awayForm: { result: string }[];
  homeSchedule: MatchRow[];
  awaySchedule: MatchRow[];
  homeAtHomeForm: { result: string }[];
  awayOnRoadForm: { result: string }[];
  homeGoalStats: ReturnType<typeof computeGoalStats>;
  awayGoalStats: ReturnType<typeof computeGoalStats>;
  marketOdds: Awaited<ReturnType<typeof getMarketOdds>>;
  lineups: Awaited<ReturnType<typeof getLineups>>;
  missingHome: string[];
  missingAway: string[];
  homeAbsenceScore?: number;
  awayAbsenceScore?: number;
  calibration?: LeagueCalibration | null;
  leagueParams?: LeagueModelParams | null;
  archiveHome?: TeamArchiveRatings | null;
  archiveAway?: TeamArchiveRatings | null;
  homeRestDays?: number | null;
  awayRestDays?: number | null;
  seasonContext?: ReturnType<typeof buildSeasonContext>;
  optaMatch?: OptaMatch | null;
  preMatchChecklist?: ReturnType<typeof buildPreMatchChecklistData>;
  eventMeta?: Awaited<ReturnType<typeof fetchEventMeta>>;
  homeName?: string;
  awayName?: string;
  homeStanding?: StandingRow;
  awayStanding?: StandingRow;
  homeAbsenceReport?: ReturnType<typeof buildKeyAbsenceReport>;
  awayAbsenceReport?: ReturnType<typeof buildKeyAbsenceReport>;
}) {
  const {
    homeName,
    awayName,
    homeStanding,
    awayStanding,
    homeForm,
    awayForm,
    homeSchedule,
    awaySchedule,
    homeGoalStats,
    awayGoalStats,
    marketOdds,
    lineups,
    missingHome,
    missingAway,
    homeAbsenceScore = 0,
    awayAbsenceScore = 0,
    calibration,
    leagueParams,
    archiveHome,
    archiveAway,
    homeRestDays,
    awayRestDays,
    seasonContext,
    optaMatch,
    preMatchChecklist,
    eventMeta,
    homeAbsenceReport,
    awayAbsenceReport,
  } = input;

  const leagueAvg =
    leagueParams?.avgGoals ??
    calibration?.historicalBaseline?.avgGoals ??
    (homeGoalStats && awayGoalStats
      ? (homeGoalStats.avgGoalsFor +
          homeGoalStats.avgGoalsAgainst +
          awayGoalStats.avgGoalsFor +
          awayGoalStats.avgGoalsAgainst) /
        4
      : 2.65);

  const homeVenue = goalStatsForVenue(homeSchedule, "home");
  const awayVenue = goalStatsForVenue(awaySchedule, "away");

  let homeAttack =
    homeVenue?.avgGoalsFor ?? homeGoalStats?.avgGoalsFor ?? leagueAvg / 2;
  let homeDefense =
    homeVenue?.avgGoalsAgainst ?? homeGoalStats?.avgGoalsAgainst ?? leagueAvg / 2;
  let awayAttack =
    awayVenue?.avgGoalsFor ?? awayGoalStats?.avgGoalsFor ?? leagueAvg / 2;
  let awayDefense =
    awayVenue?.avgGoalsAgainst ?? awayGoalStats?.avgGoalsAgainst ?? leagueAvg / 2;

  if (homeStanding && awayStanding && homeStanding.played >= 5) {
    const played = homeStanding.played;
    homeAttack *= 1 + (homeStanding.gf / played - leagueAvg / 2) * 0.12;
    homeDefense *= 1 + (homeStanding.ga / played - leagueAvg / 2) * 0.08;
    awayAttack *= 1 + (awayStanding.gf / played - leagueAvg / 2) * 0.12;
    awayDefense *= 1 + (awayStanding.ga / played - leagueAvg / 2) * 0.08;
  }

  // Nyckelavbräck: ungefär 0.15–0.25 mål per poäng absenceScore
  homeAttack = Math.max(0.4, homeAttack - homeAbsenceScore * 0.06);
  awayAttack = Math.max(0.4, awayAttack - awayAbsenceScore * 0.06);

  if (archiveHome) {
    homeAttack = 0.55 * homeAttack + 0.45 * archiveHome.attack;
    homeDefense = 0.55 * homeDefense + 0.45 * archiveHome.defense;
  }
  if (archiveAway) {
    awayAttack = 0.55 * awayAttack + 0.45 * archiveAway.attack;
    awayDefense = 0.55 * awayDefense + 0.45 * archiveAway.defense;
  }

  const homeAdv = leagueParams?.homeAdvantage ?? 1.18;

  const poisson = poissonMatchPrediction({
    homeAttack,
    homeDefense,
    awayAttack,
    awayDefense,
    leagueAvgGoals: leagueAvg,
    homeAdvantage: homeAdv,
  });

  let { homeWinPct, drawPct, awayWinPct } = poisson.probs;
  let predictedScore = poisson.predictedScore;

  if (marketOdds?.marketProbPct) {
    const modelWeight = leagueParams?.marketBlendWeight ?? 0.48;
    const blended = blendWithMarket(
      { homeWinPct, drawPct, awayWinPct },
      marketOdds.marketProbPct,
      modelWeight,
    );
    homeWinPct = blended.homeWinPct;
    drawPct = blended.drawPct;
    awayWinPct = blended.awayWinPct;
  }

  const calAdj = calibrationToAdjustments(calibration);
  ({ homeWinPct, drawPct, awayWinPct } = applyCalibrationAdjustments(
    { homeWinPct, drawPct, awayWinPct },
    calAdj,
  ));

  const motivatedSide = seasonContext?.motivatedSide ?? null;

  const pro = applyProBettorAdjustments(
    { homeWinPct, drawPct, awayWinPct },
    {
      homeRestDays,
      awayRestDays,
      ptsDiff: homeStanding && awayStanding ? homeStanding.pts - awayStanding.pts : undefined,
      gdDiff: homeStanding && awayStanding ? homeStanding.gd - awayStanding.gd : undefined,
      motivationAsymmetry: seasonContext?.motivationAsymmetry,
      motivatedSide,
      homeStakeLabel: seasonContext?.home.stakeLabel,
      awayStakeLabel: seasonContext?.away.stakeLabel,
      homeAbsenceScore,
      awayAbsenceScore,
      marketProbPct: marketOdds?.marketProbPct,
    },
  );
  ({ homeWinPct, drawPct, awayWinPct } = pro.probs);

  const outcome = pickOutcome(homeWinPct, drawPct, awayWinPct);

  let confidence = deriveConfidence(homeWinPct, drawPct, awayWinPct);

  const keyFactors: string[] = [];
  if (leagueParams && leagueParams.backtestMatches >= 30) {
    keyFactors.push(
      `3-års ligahistorik: ${leagueParams.backtestMatches} matcher, snitt ${leagueParams.avgGoals.toFixed(2)} mål, H/X/2 ${(leagueParams.homeWinRate * 100).toFixed(0)}/${(leagueParams.drawRate * 100).toFixed(0)}/${(leagueParams.awayWinRate * 100).toFixed(0)}%.`,
    );
  }
  if (homeStanding && awayStanding) {
    keyFactors.push(
      `Tabell: ${homeName} plats ${homeStanding.rank} (${homeStanding.pts} p) vs ${awayName} plats ${awayStanding.rank} (${awayStanding.pts} p).`,
    );
  }
  if (seasonContext) {
    keyFactors.push(
      `Säsongsinsats: ${homeName} (${seasonContext.home.stakeLabel}, plats ${seasonContext.home.rank}) vs ${awayName} (${seasonContext.away.stakeLabel}, plats ${seasonContext.away.rank}).`,
    );
  }
  if (homeForm.length) {
    keyFactors.push(
      `Form senaste 5: ${homeName} ${homeForm.map((m) => m.result).join("-")}, ${awayName} ${awayForm.map((m) => m.result).join("-")}.`,
    );
  }
  if (marketOdds) {
    keyFactors.push(
      `Marknaden (ESPN): 1 ${marketOdds.marketProbPct.home}% · X ${marketOdds.marketProbPct.draw}% · 2 ${marketOdds.marketProbPct.away}%.`,
    );
  }
  if (optaMatch) {
    keyFactors.push(`${formatOptaMatchSummary(optaMatch)} (synkad data).`);
  }
  for (const n of pro.notes) keyFactors.push(n);
  if (calibration?.resolved && calibration.resolved >= 5) {
    keyFactors.push(
      `Egna tips i DB: ${calibration.resolved} avgjorda, träff ${(calibration.hitRate * 100).toFixed(0)}%.`,
    );
  }
  if (calibration?.topLessons.length) {
    keyFactors.push(`Lärdom: ${calibration.topLessons[0]}`);
  }
  keyFactors.push("Poisson/Dixon-Coles + proffsregler + ligahistorik.");

  const proAdvice = buildProBettingAdvice(
    { homeWinPct, drawPct, awayWinPct },
    { marketProbPct: marketOdds?.marketProbPct },
    confidence,
  );
  confidence = proAdvice.confidence;

  const tipLabel = outcomeToTip(outcome);
  const top = Math.max(homeWinPct, drawPct, awayWinPct);

  const btts = predictBtts({
    lamH: poisson.lamH,
    lamA: poisson.lamA,
    matrix: poisson.matrix,
    homeAttack,
    homeDefense,
    awayAttack,
    awayDefense,
    homeGoalStats: homeGoalStats ?? undefined,
    awayGoalStats: awayGoalStats ?? undefined,
    leagueBttsRate: leagueParams?.bttsRate ?? calibration?.btts?.pct,
    calibrationBttsPct:
      calibration?.btts?.n && calibration.btts.n >= 5
        ? calibration.btts.pct * 100
        : undefined,
    homeAbsenceScore,
    awayAbsenceScore,
    homeName,
    awayName,
  });
  const bttsCall = btts.call;

  predictedScore = resolvePredictedScore({
    matrix: poisson.matrix,
    homeWinPct,
    drawPct,
    awayWinPct,
    bttsCall,
    fallbackScore: predictedScore,
  });

  const lineupNotes =
    lineups.released && (missingHome.length || missingAway.length)
      ? `Startelvor släppta. Saknas: ${missingHome.length ? homeName + " (" + missingHome.slice(0, 3).join(", ") + ")" : ""}${missingHome.length && missingAway.length ? "; " : ""}${missingAway.length ? awayName + " (" + missingAway.slice(0, 3).join(", ") + ")" : ""}.`
      : lineups.released
        ? "Startelvor släppta enligt ESPN."
        : "Startelvor ej släppta ännu.";

  const matchAnalysis: MatchAnalysisSections | null = preMatchChecklist
    ? buildTemplateMatchAnalysis({
        homeName,
        awayName,
        checklist: preMatchChecklist,
        homeGoalStats,
        awayGoalStats,
        homeStanding: homeStanding
          ? {
              rank: homeStanding.rank,
              pts: homeStanding.pts,
              gf: homeStanding.gf,
              ga: homeStanding.ga,
              played: homeStanding.played,
            }
          : undefined,
        awayStanding: awayStanding
          ? {
              rank: awayStanding.rank,
              pts: awayStanding.pts,
              gf: awayStanding.gf,
              ga: awayStanding.ga,
              played: awayStanding.played,
            }
          : undefined,
        bttsCall,
        bttsReason: btts.reason,
        seasonContext: seasonContext
          ? {
              home: { stakeLabel: seasonContext.home.stakeLabel, rank: seasonContext.home.rank },
              away: { stakeLabel: seasonContext.away.stakeLabel, rank: seasonContext.away.rank },
              motivatedSide: seasonContext.motivatedSide,
            }
          : null,
        marketOdds: marketOdds
          ? { marketProbPct: marketOdds.marketProbPct, decimalOdds: marketOdds.decimalOdds }
          : null,
        modelPct: { home: homeWinPct, draw: drawPct, away: awayWinPct },
        homeAbsenceScore: homeAbsenceScore,
        awayAbsenceScore: awayAbsenceScore,
        keyAbsencesHome: homeAbsenceReport?.keyAbsences.map((p) => p.name),
        keyAbsencesAway: awayAbsenceReport?.keyAbsences.map((p) => p.name),
        lineupReleased: lineups.released,
      })
    : null;

  return {
    homeWinPct,
    drawPct,
    awayWinPct,
    predictedScore,
    confidence,
    keyFactors: keyFactors.slice(0, 6),
    bettingTip: proAdvice.bettingTip,
    bttsCall,
    bttsReason: btts.reason,
    valueBet: proAdvice.valueBet,
    lineupNotes,
    lineupValueShift: (missingHome.length || missingAway.length ? "okänt" : "oförändrat") as
      | "ökat"
      | "minskat"
      | "oförändrat"
      | "okänt",
    source: "espn-stat" as const,
    lineupReleased: lineups.released,
    missingHome,
    missingAway,
    marketOdds: marketOdds
      ? {
          decimalOdds: marketOdds.decimalOdds,
          marketProbPct: marketOdds.marketProbPct,
          books: marketOdds.providers,
        }
      : null,
    matchAnalysis,
    eventMeta,
  };
}

export async function generateMatchPrediction(data: z.infer<typeof predictMatchInputSchema>) {
    const apiKey = process.env.LOVABLE_API_KEY;

    const lg = LEAGUES.find((l) => l.id === data.leagueId);
    const [standings, homeSchedule, awaySchedule, homeRoster, awayRoster, bolldata, lineups, homeInjuries, awayInjuries] =
      await Promise.all([
        leagueStandings(data.leagueId),
        teamScheduleAll(data.leagueId, data.homeId),
        teamScheduleAll(data.leagueId, data.awayId),
        teamRoster(data.leagueId, data.homeId),
        teamRoster(data.leagueId, data.awayId),
        data.leagueId === "swe.1"
          ? fetchAllsvenskanAdvanced()
          : Promise.resolve({ rows: [] }),
        getLineups(data.leagueId, data.homeId, data.awayId),
        getTransfermarktInjuries(data.homeName),
        getTransfermarktInjuries(data.awayName),
      ]);

    const homeForm = homeSchedule.slice(-6).map((m: MatchRow) => ({
      result: m.result, score: m.score, opponent: m.opponent, homeAway: m.homeAway,
    }));
    const awayForm = awaySchedule.slice(-6).map((m: MatchRow) => ({
      result: m.result, score: m.score, opponent: m.opponent, homeAway: m.homeAway,
    }));

    // Expert-additions: H2H, hemma-/bortaform separat, måltrender, vila, marknadsodds
    const h2h = buildH2H(homeSchedule, data.awayId);
    const homeAtHomeForm = homeAwaySplitForm(homeSchedule, "home");
    const awayOnRoadForm = homeAwaySplitForm(awaySchedule, "away");
    const homeGoalStats = computeGoalStats(homeSchedule);
    const awayGoalStats = computeGoalStats(awaySchedule);
    const homeRestDays = daysSinceLast(homeSchedule);
    const awayRestDays = daysSinceLast(awaySchedule);
    const [marketOdds, eventMeta] = await Promise.all([
      lineups.eventId
        ? getMarketOdds(data.leagueId, lineups.eventId)
        : Promise.resolve(null),
      lineups.eventId
        ? fetchEventMeta(data.leagueId, lineups.eventId)
        : Promise.resolve(null),
    ]);

    // Allsvenskan: hämta dagens trupp från klubbens hemsida om möjligt.
    const matchDate = lineups.eventDate ? new Date(lineups.eventDate) : new Date();
    let homeMatchdaySquad: MatchdaySquad = { source: "club-site:skipped", url: null, players: [] };
    let awayMatchdaySquad: MatchdaySquad = { source: "club-site:skipped", url: null, players: [] };
    if (data.leagueId === "swe.1") {
      [homeMatchdaySquad, awayMatchdaySquad] = await Promise.all([
        fetchMatchdaySquad(data.homeName, data.awayName, matchDate),
        fetchMatchdaySquad(data.awayName, data.homeName, matchDate),
      ]);
    }

    const missingFrom = (squad: string[], lu: { starters: string[]; bench: string[] }) => {
      if (!lu.starters.length) return [] as string[];
      const present = new Set([...lu.starters, ...lu.bench].map((n) => n.toLowerCase()));
      return squad.filter((n) => !present.has(n.toLowerCase()));
    };
    const missingHome = lineups.released
      ? missingFrom(homeRoster.map((p: { name: string }) => p.name), lineups.home)
      : [];
    const missingAway = lineups.released
      ? missingFrom(awayRoster.map((p: { name: string }) => p.name), lineups.away)
      : [];
    const homeAbsenceReport = buildKeyAbsenceReport(
      homeRoster,
      homeInjuries.injuries,
      missingHome,
      lineups.released,
    );
    const awayAbsenceReport = buildKeyAbsenceReport(
      awayRoster,
      awayInjuries.injuries,
      missingAway,
      lineups.released,
    );

    const homeStanding = standings.find((s: StandingRow) => s.teamId === data.homeId);
    const awayStanding = standings.find((s: StandingRow) => s.teamId === data.awayId);

    const injuredHome = homeRoster.filter((p: { injured: string | null }) => p.injured);
    const injuredAway = awayRoster.filter((p: { injured: string | null }) => p.injured);

    const homeAdv =
      data.leagueId === "swe.1"
        ? findBolldataRow(bolldata.rows, data.homeName)
        : undefined;
    const awayAdv =
      data.leagueId === "swe.1"
        ? findBolldataRow(bolldata.rows, data.awayName)
        : undefined;

    const seasonContext = buildSeasonContext(standings, data.homeId, data.awayId, data.leagueId);

    const preMatchChecklist = buildPreMatchChecklistData({
      homeSchedule,
      awaySchedule,
      homeTeamId: data.homeId,
      awayTeamId: data.awayId,
      standings: standings.map((s) => ({ teamId: s.teamId, rank: s.rank })),
      h2h,
      homeGoalStats,
      awayGoalStats,
      eventMeta,
    });

    const context = {
      league: lg?.name ?? data.leagueId,
      ...(seasonContext ? { seasonContext } : {}),
      home: {
        name: data.homeName,
        rank: homeStanding?.rank,
        points: homeStanding?.pts,
        played: homeStanding?.played,
        goalsFor: homeStanding?.gf,
        goalsAgainst: homeStanding?.ga,
        goalDiff: homeStanding?.gd,
        expectedPoints: homeStanding?.xPts,
        luckIndex: homeStanding?.luck,
        xG_real: homeAdv?.xG,
        xGA_real: homeAdv?.xGA,
        xPts_real: homeAdv?.xPts,
        luck_real: homeAdv?.luck,
        last5: homeForm,
        last5AtHome: homeAtHomeForm,
        goalTrendsLast10: homeGoalStats,
        restDays: homeRestDays,
        squad: homeRoster.map((p: { name: string }) => p.name),
        injuredFromFeed: injuredHome,
        confirmedInjuries: homeInjuries.injuries,
        injurySource: homeInjuries.source,
        confirmedStartingXI: lineups.home.starters,
        bench: lineups.home.bench,
        missingFromMatchday: missingHome,
        keyAbsences: homeAbsenceReport.keyAbsences,
        absenceScore: homeAbsenceReport.absenceScore,
        missingByPosition: homeAbsenceReport.missingByPos,
        matchdaySquad: homeMatchdaySquad.players.length
          ? { source: homeMatchdaySquad.source, url: homeMatchdaySquad.url, players: homeMatchdaySquad.players }
          : null,
      },
      away: {
        name: data.awayName,
        rank: awayStanding?.rank,
        points: awayStanding?.pts,
        played: awayStanding?.played,
        goalsFor: awayStanding?.gf,
        goalsAgainst: awayStanding?.ga,
        goalDiff: awayStanding?.gd,
        expectedPoints: awayStanding?.xPts,
        luckIndex: awayStanding?.luck,
        xG_real: awayAdv?.xG,
        xGA_real: awayAdv?.xGA,
        xPts_real: awayAdv?.xPts,
        luck_real: awayAdv?.luck,
        last5: awayForm,
        last5OnRoad: awayOnRoadForm,
        goalTrendsLast10: awayGoalStats,
        restDays: awayRestDays,
        squad: awayRoster.map((p: { name: string }) => p.name),
        injuredFromFeed: injuredAway,
        confirmedInjuries: awayInjuries.injuries,
        injurySource: awayInjuries.source,
        confirmedStartingXI: lineups.away.starters,
        bench: lineups.away.bench,
        missingFromMatchday: missingAway,
        keyAbsences: awayAbsenceReport.keyAbsences,
        absenceScore: awayAbsenceReport.absenceScore,
        missingByPosition: awayAbsenceReport.missingByPos,
        matchdaySquad: awayMatchdaySquad.players.length
          ? { source: awayMatchdaySquad.source, url: awayMatchdaySquad.url, players: awayMatchdaySquad.players }
          : null,
      },
      headToHead: h2h,
      preMatchChecklist,
      eventMeta,
      marketOdds,
      lineupStatus: lineups.released
        ? `Officiella startelvor släppta (${lineups.source})`
        : "Startelvor ej släppta ännu — kontrollera närmare avspark",
      dataSources:
        "ESPN" + (marketOdds ? " + bookmaker-odds (ESPN pickcenter)" : ""),
    };

    const calibration = await getCalibration(data.leagueId).catch(() => null);

    const leagueArchiveStats = await getLeagueArchiveStats(data.leagueId).catch(() => null);
    const leagueParams = await getLeagueModelParams(data.leagueId).catch(() => null);
    const optaMatches = await getCachedOptaMatches().catch(() => []);
    const optaMatch = findOptaMatch(optaMatches, data.homeName, data.awayName) ?? null;
    const archiveRatings = leagueArchiveStats
      ? await getTeamArchiveRatings(
          data.leagueId,
          data.homeId,
          data.awayId,
          leagueArchiveStats.avgGoals,
        ).catch(() => ({ home: null, away: null }))
      : { home: null, away: null };

    const poissonBaselineInput = {
      homeName: data.homeName,
      awayName: data.awayName,
      homeStanding,
      awayStanding,
      homeForm,
      awayForm,
      homeSchedule,
      awaySchedule,
      homeAtHomeForm,
      awayOnRoadForm,
      homeGoalStats,
      awayGoalStats,
      marketOdds,
      lineups,
      missingHome,
      missingAway,
      homeAbsenceScore: homeAbsenceReport.absenceScore,
      awayAbsenceScore: awayAbsenceReport.absenceScore,
      calibration,
      leagueParams,
      archiveHome: archiveRatings.home,
      archiveAway: archiveRatings.away,
      homeRestDays,
      awayRestDays,
      seasonContext,
      optaMatch,
      preMatchChecklist,
      eventMeta,
      homeAbsenceReport,
      awayAbsenceReport,
    };

    if (!apiKey) {
      const stat = buildStatisticalPrediction(poissonBaselineInput);
      savePrediction({
        leagueId: data.leagueId,
        homeId: data.homeId,
        awayId: data.awayId,
        homeName: data.homeName,
        awayName: data.awayName,
        eventId: lineups.eventId ?? null,
        eventDate: lineups.eventDate ?? null,
        homeWinPct: stat.homeWinPct,
        drawPct: stat.drawPct,
        awayWinPct: stat.awayWinPct,
        predictedScore: stat.predictedScore,
        confidence: stat.confidence,
        bettingTip: stat.bettingTip,
        keyFactors: stat.keyFactors,
        lineupReleased: lineups.released,
        round: data.round ?? null,
        bttsCall: stat.bttsCall,
        bttsReason: stat.bttsReason,
        matchAnalysis: stat.matchAnalysis ?? null,
      }).catch((e) => console.error("savePrediction error", e));
      return stat;
    }

    const sys = `Du är en expertanalytiker för fotbollsbetting. Analysera matchen utifrån:
- Senaste 5–6 matcher (form) — se 'last5' och 'preMatchChecklist.homeLast6/awayLast6'
- Tabellplats, poäng, mål för/emot, målskillnad
- expectedPoints (xPts) = poäng laget BORDE haft baserat på målskillnad
- luckIndex = poäng - xPts. + = överpresterat (regression väntad), − = otur (studsa tillbaka)
- Hemmaplansfördel
- Avancerad data (Allsvenskan, från bolldata.se): xG_real, xGA_real, xPts_real och luck_real (pts − xPts_real). Detta är faktisk skottkvalitetsdata och VIKTIGARE än xPts-proxyn när den finns. Vikta luck_real tungt: stark + = lag har haft tur, regression väntad. Stark − = lag har haft otur, sannolikt bättre framöver.
- Personal: ${context.home.squad.length > 0 ? "Verkliga trupper för båda lagen finns i 'squad'-listorna." : "Trupp-data saknas."}
- 'keyAbsences' och 'absenceScore' är förberäknade signaler för viktiga avbräck. Högre absenceScore = större tapp i laget. Detta ska väga TUNGT i Allsvenskan där enstaka nyckelspelare ofta flyttar sannolikheten mycket.

KRITISKT OM SPELARNAMN — följ dessa regler exakt:
1. Du får ENDAST namnge spelare som FAKTISKT finns i respektive lags 'squad'-lista. Hitta ALDRIG på spelare eller använd din egen kunskap för att lista spelare som inte finns i listan.
2. Om en spelare INTE står i 'squad'-listan så spelar hen inte i klubben — nämn dem aldrig.
3. 'confirmedInjuries' (Transfermarkt) är den AUKTORITATIVA skadelistan med spelarnamn, skadeorsak, sedan-datum, förväntad återkomst och antal missade matcher. Använd ALLTID denna före 'injuredFromFeed'. Nämn samtliga relevanta nyckelspelare som finns där (t.ex. förstemålvakt, ordinarie anfallare, ordinarie back). Om listan är tom, skriv "Inga bekräftade skador i Transfermarkt".
4. Om du nämner en specifik spelare som risk/styrka, måste namnet ordagrant matcha 'squad'-listan.

OFFICIELLA STARTELVOR:
- Om 'lineupStatus' säger att startelvorna är släppta så är 'confirmedStartingXI' den OFFICIELLA elvan från ESPN. Använd den som facit.
- 'missingFromMatchday' = spelare i truppen som varken startar eller sitter på bänken — sannolikt avstängda/skadade/utanför trupp.
- Bedöm om någon av dessa är en NYCKELSPELARE (känd målskytt, ordinarie back/mittfältare, etablerad startelva). Om ja, sätt 'lineupValueShift' = "ökat" eller "minskat" beroende på vilket lag som tappar och förklara i 'lineupNotes'.
- När en nyckelspelare saknas i hemmalaget → spelvärdet på X eller 2 ökar normalt. När en nyckelspelare saknas i bortalaget → spelvärdet på 1 ökar.
- Om startelvor inte är släppta sätt 'lineupValueShift' = "okänt".
- När du letar skrällar: om favoriten har högre absenceScore än underdogen, eller saknar målvakt/centrallinje/anfallare i 'keyAbsences', ska du tydligt överväga X eller 2 som skrällspel.

ALLSVENSKAN — MATCHDAGSTRUPP FRÅN KLUBBENS HEMSIDA:
- 'matchdaySquad' (om satt) är den OFFICIELLA matchdagstruppen som klubben själv publicerat (innehåller tröjnummer + namn, 'gk' markerar målvakter). Detta är den högsta auktoriteten på vilka spelare som faktiskt är tillgängliga.
- Om 'matchdaySquad' är satt: bedöm vilka nyckelspelare i 'squad' som SAKNAS i 'matchdaySquad.players' — det är bekräftade avbräck för matchen, även om Transfermarkt inte rapporterat skada. Vikta detta TUNGT (samma vikt som officiell startelva).
- Saknas en känd förstemålvakt, ordinarie anfallare eller ordinarie back i 'matchdaySquad' → kraftigt argument för skräll (X/2 om hemmalaget tappar, 1 om bortalaget tappar).

EXPERT-DATA (väg in i analysen):
- 'headToHead' = sista 5 inbördes mötena ur hemmalagets perspektiv. Mönster (t.ex. bortalaget vinner 4 av 5) väger TUNGT.
- 'preMatchChecklist' = förberäknad checklista: hemma-/bortarekord (poäng, GD, BTTS%, nolla%), målprofil (målrik/låst), favoritvinster hemma, poäng borta mot topplag, H2H-snitt.
- 'last5AtHome' = hemmalagets form ENDAST på hemmaplan. 'last5OnRoad' = bortalagets form ENDAST på bortaplan. Använd dessa istället för bara 'last5' när du bedömer hemma-/bortakapacitet.
- 'goalTrendsLast10' = snitt mål för/emot, BTTS%, Over 2.5%, clean sheets, failed-to-score (sista 10). Använd för att kalibrera 'predictedScore' och välja över/under-tips.
- 'restDays' = dagar sedan senaste match. <4 dagar = matchtrötthet, risk för svagare prestation.
- 'eventMeta' = väder, domare, arena om ESPN har data.
- 'marketOdds' = bookmakers konsensus med 'marketProbPct' (%-sannolikhet utan overround). JÄMFÖR alltid din egen homeWinPct/drawPct/awayWinPct mot marknaden. Om din sannolikhet skiljer >5%-enheter från marknaden = potentiellt VÄRDESPEL — nämn det explicit i 'bettingTip' och 'valueBet'.

OBLIGATORISK BETTING-CHECKLISTA — fyll fälten 'matchAnalysis' med 2–4 meningar svenska per avsnitt (utifrån datan, inga påhittade spelare):
1. grundlaggande — form senaste 5–6, hemma-/bortastatistik (poäng, GD, vinster), snitt mål anfall/försvar, målrik vs låst matchprofil.
2. btts — BTTS% totalt/hemma/borta, clean sheets, tendens att släppa in mål, anfallsstil om datan räcker (xG, över 2.5).
3. oneXtwo — realistisk vinstchans 1/X/2, favoritvinster hemma, bortaresultat mot topplag, tabell/motivation (europaplats, nedflyttning, titel via seasonContext).
4. h2h — tidigare möten, särskilt på samma arena, målrika eller låsta inbördes matcher.
5. lagnyheter — skador/avstängningar, återkommande spelare, förväntad startelva (anfall/mittfält), taktik/formation om signal finns.
6. ovrigt — väder, domarprofil, matchpress (derby, tränarpress), marknadens odds vs din bedömning (valueBet).

VAD PROFFSTIPPARE KOLLAR PÅ (gör en egen mental checklista på dessa innan du sätter tipset, och nämn de som väger tyngst i 'keyFactors'):
1. Motivation & insats: Spelar något av lagen om guld/Europaplats/nytt kontrakt/kval? Är ett lag redan klart för nedflyttning eller har inget att spela för? Omotiverade favoriter underpresterar nästan alltid.
2. Schemaläge & rotation: Har laget cupmatch eller Europa-match dagar före/efter? Tränare roterar ofta då — favoritens spelvärde sjunker.
3. xG-trend, inte bara resultat: Ett lag som vunnit 3-0, 1-0, 2-1 på låg xG är på lånad tid (regression). Ett lag som förlorat på hög xG är sannolikt bättre än tabellen visar. Använd luck_real och xG_real när finns.
4. Hemmaplansfördel beror på liga och lag: Vissa lag är extremt hemmastarka (publik, planmått), andra reser dåligt. Använd 'last5AtHome' och 'last5OnRoad' för att kalibrera, inte bara generella +X%.
5. Set-pieces & målvakt: Lag med stark fast-situation-poäng vinner jämna matcher. Saknad förstemålvakt är ofta värt 0.4–0.6 mål.
6. Stilmatchning: Pressande lag mot ett lag som tappar boll lågt = övertag. Defensivt block mot dåligt anfall = X-värde.
7. Tränarbyte / nyligen tillsatt tränare: De första 2–4 matcherna ger ofta en "new manager bounce" — överväg uppjustering av det laget.
8. Väder & plan: Regn/blåst/konstgräs jämnar ut spelet och ökar X- och under-värdet. Nämn det om relevant.
9. Marknadens rörelse: Stort gap mellan din modell och 'marketOdds' utan tydlig nyhetsorsak betyder oftast att marknaden vet något du missar — var ödmjuk innan du kallar det värdespel.
10. Disciplin & domare: Kort/utvisningar i kvalificerade matcher tidigare kan tyda på risk för 10-mannaspel, särskilt i derbyn.
11. Tabellpsykologi: Lag i bottenstrid hemma mot mittenlag som inget har att spela för = höjt X/1-värde. Toppstrid mellan likvärdiga lag = höjt X-värde.
12. Skrällsignaler: Hög absenceScore på favoriten + bortaresa + kort vila + omotivation = klassiskt skräll-scenario. Vikta dessa kombinerat.

ANALYSDISCIPLIN (Trademate Sports 8-stegsmodell):
A. Sätt dina sannolikheter (homeWinPct/drawPct/awayWinPct) FÖRST utifrån lag/spelare/form/H2H — INNAN du tittar på 'marketOdds'. Använd marknaden bara som efterhandskontroll, inte som utgångspunkt. Detta undviker ankringseffekten där modellen bara speglar oddsen.
B. Undvik confirmation bias: leta aktivt efter datapunkter som TALAR EMOT ditt tips (t.ex. lagets dåliga bortaform, H2H-nederlag, nyckelspelare borta). Om motbevisen är starka — sänk confidence eller byt tips.
C. Devil's advocate: ställ frågan "hur kan jag ha fel?" innan du sätter confidence. Om du inte kan ge ett trovärdigt scenario där tipset spricker så är confidence-nivån oftast för hög.
D. På stora ligor (Premier League, La Liga, Bundesliga, Serie A) är marknaden mycket effektiv — en avvikelse >8%-enheter mot 'marketOdds' utan en konkret nyhets-/skadeorsak är nästan alltid din modell som har fel, inte marknaden. Var ödmjuk där.
E. Sidomarknader (hörnor, kort, frisparkar): tänk även på stilmatchning för dessa marknader när du formulerar 'bettingTip'. Pressande lag mot lågt block → höga hörn-totals. Derbyn, hård domare, eller lag med högt antal gula kort i 'goalTrendsLast10'/form → överväg over kort. Om en uppenbar edge finns på hörnor/kort som är starkare än 1X2-edgen, nämn den explicit som alternativt spel i 'bettingTip'.
F. Closing Line Value (CLV) — den viktigaste långsiktiga mätaren: ditt tips ska helst slå STÄNGNINGSODDSEN, inte bara vinna enskild match. När du jämför din sannolikhet mot 'marketOdds' (som är aktuell, ej stängning), tänk på att marknaden ofta rör sig mot rätt pris fram till avspark. Om din edge är liten (<3%-enheter) och tidig i veckan kan den ätas upp av linjerörelse — var försiktig med "värdespel"-flaggan då. Stor edge (>5%-enheter) som håller även när matchen närmar sig avspark = äkta CLV-spel.

ANTI-HOME-BIAS (kritiskt — historiska data: 71% av tipsen blev 1, men bara 44% av matcherna slutar med 1):
- Standings och målskillnad (GD) väger TUNGT. Använd dessa hårda tröskelvärden som STARTPUNKT innan hemmaplansfördel läggs på:
  * Om BORTALAGET har ≥8 poäng MER än hemmalaget OCH bättre GD → bortalaget är favorit. Sätt awayWinPct ≥ homeWinPct även efter hemmaplansjustering. Hemmaplansfördel är typiskt värd ~5-8%-enheter, INTE 15-20.
  * Om bortalaget har ≥15 poäng mer + klart bättre GD + bättre form senaste 5 → awayWinPct bör vara ≥40% och tydligt högst.
  * Hemmaplansfördel motiverar ALDRIG att göra det sämre laget (enligt tabell + GD + form) till tippad vinnare. Maxjustering för hemmaplan = +8%-enheter på homeWinPct, inte mer.
- 'luckIndex' / 'luck_real' ska användas som FINJUSTERING, inte som huvudargument. Att hemmalaget "har haft otur" räcker inte för att göra dem till favorit över ett tabellmässigt starkare bortalag — det justerar bara sannolikheter ±3-5%-enheter.
- När du sätter predicted_outcome: pick alltid det utfall som har HÖGST procent. Om awayWinPct är högst → predicted_outcome = "A". Inga undantag för "magkänsla" eller "hemmaplan".
- Sanity-check INNAN du returnerar: om hemmalaget ligger ≥3 platser lägre i tabellen, har sämre GD och sämre form än bortalaget — och du ändå tippat 1 — gå tillbaka och justera. Skriv i keyFactors varför du inte föll för home-bias.

KALIBRERING & KRYSS-REALISM (forskning + historik):
- Dixon-Coles/Poisson är standard i akademisk fotbollsmodellering: vanlig Poisson UNDERSKATTAR kryss och låga mål (0-0, 1-1). drawPct ska därför SÄLLAN vara <18% och nästan ALDRIG <12%.
- Faktisk basfördelning i ligafotboll: H≈42%, D≈26%, A≈32%. När lagen är jämna (poängskillnad <6, liknande form/GD) → drawPct 28-34% och kan vara HÖGST → predicted_outcome = "D".
- Kalibrering är VIKTIGARE än ren träffsäkerhet för betting (forskning 2024): sannolikheterna ska spegla verklig frekvens, inte bara "rätt lag oftast".
- LLM:er är systematiskt ÖVERKONFIDENTA — sätt sannolikheter konservativt. Max homeWinPct/awayWinPct = 65% i typisk ligamatch. >70% är extremt sällsynt.
- Starka bortafavoriter (awayWinPct ≥55% som högst utfall): dra ned 5-8%-enheter och flytta till D — historiskt överpresterade.
- Två jämna lag = ~38/30/32, inte 50/20/30.
- 'confidence' sätts automatiskt efter sannolikheter (≥58% + marginal ≥12 för "hög") — du behöver inte överdriva.
- KOHERENS: predictedScore MÅSTE matcha högsta utfall (1/2/X). Aldrig 1-1 om tipset är 1 eller 2.

SÄSONGSSLUT — SEASONCONTEXT (endast när fältet finns med):
- 'seasonContext' inkluderas BARA när ≤6 omgångar återstår. Saknas fältet → ignorera detta avsnitt helt.
- När fältet finns: 'home.stake' och 'away.stake' säger vad respektive lag spelar för (guld / topp-strid / cl-säkrad / europa-kamp / europaplats / europa-säkrad / kvalplats / nedflyttning / inget-att-spela-for). 'stakeLabel' är läsbar svensk text.
- 'motivationAsymmetry' = true när motivationspoäng skiljer ≥4 (t.ex. hemmalag jagar Europa, bortalag CL redan säkrad). 'motivatedSide' = "home" eller "away". Höj sannolikheten för det motiverade laget ~5-8%-enheter.
- 'historicalPattern' beskriver det historiska utfallsmönstret för just den här typen av match. Använd det för att kalibrera sannolikheter, predictedScore och bettingTip (t.ex. fler X i bottenmöten, lågscoring i six-pointers).
- Var extra försiktig med "omotiverad favorit": en topp/mitten-klubb utan stakes som möter ett desperat lag i bottenstrid → underdog-värde på 1 eller 2 är ofta större än oddsen visar.

Returnera ENDAST giltig JSON enligt schemat.`;

    const calibrationHint = calibration ? buildCalibrationHint(calibration) : null;
    const globalPrompt = await getModelPromptText("football-global").catch(() => null);
    const customPrompt = await getLeaguePromptText(data.leagueId).catch(() => null);
    const statBaseline = buildStatisticalPrediction(poissonBaselineInput);

    const userPrompt = `${
      globalPrompt
        ? `### GLOBAL TRÄNINGSPROMPT — FOTBOLL (AI-genererad från senaste 500 matcherna) ###\n${globalPrompt}\n\n---\n\n`
        : ""
    }${
      customPrompt
        ? `### ABSOLUT HÖGSTA PRIORITET — LIGASPECIFIK TRÄNINGSPROMPT (AI-genererad från resolverade tips) ###\n${customPrompt}\n\n---\n\n`
        : ""
    }${
      calibrationHint
        ? `### HÖGSTA PRIORITET — LIGASPECIFIK TRÄNING (väg detta TYNGRE än generella regler) ###\n${calibrationHint}\n\nFÖLJ dessa lärdomar aktivt när du sätter sannolikheter, predicted_outcome och bettingTip. Om något i lärdomarna motsäger din magkänsla — lita på lärdomarna, de bygger på faktiskt utfall i just denna liga.\n\n---\n\n`
        : ""
    }### STATISTISK DIXON-COLES-BASELINE (sätt dina sannolikheter NÄRA denna om du inte har starka skäl att avvika) ###
1=${statBaseline.homeWinPct}% · X=${statBaseline.drawPct}% · 2=${statBaseline.awayWinPct}%
Föreslagen ställning: ${statBaseline.predictedScore} · Konfidens: ${statBaseline.confidence}
${statBaseline.keyFactors.slice(0, 2).join(" ")}

Matchdata:\n${JSON.stringify(context, null, 2)}\n\nGe en betting-analys med ifylld 'matchAnalysis' (alla 6 avsnitt). Var extra noga med att inte hitta på spelare. Justera sannolikheterna från baseline endast med tydliga matchspecifika skäl (skador, motivation, H2H).`;

    const callAI = async (model: string) =>
      fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: sys },
            { role: "user", content: userPrompt },
          ],
          tools: [
            {
              type: "function",
              function: {
                name: "submit_prediction",
                description: "Returnera matchprognos",
                parameters: {
                  type: "object",
                  properties: {
                    homeWinPct: { type: "number", description: "0-100" },
                    drawPct: { type: "number", description: "0-100" },
                    awayWinPct: { type: "number", description: "0-100" },
                    predictedScore: { type: "string", description: "t.ex. '2-1'" },
                    confidence: { type: "string", enum: ["låg", "medel", "hög"] },
                    keyFactors: {
                      type: "array",
                      items: { type: "string" },
                      description: "3-5 korta punkter på svenska",
                    },
                    bettingTip: { type: "string" },
                    bttsCall: {
                      type: "string",
                      enum: ["ja", "nej", "osäker"],
                      description: "Gör båda lagen mål? Använd goalTrendsLast10 (bttsPct, failedToScore, cleanSheet) + form.",
                    },
                    bttsReason: {
                      type: "string",
                      description: "1-2 meningar på svenska om varför BTTS ja/nej (mål-snitt, defensiv stabilitet, motivation).",
                    },
                    valueBet: {
                      type: "string",
                      description: "Spelvärde-analys mot 'marketOdds'. Format: 'Värde på 1 @ 2.40 — modell 52% vs marknad 42% (+10%)' ELLER 'Inget spelvärde — modell i linje med marknaden'. Om marketOdds saknas: 'Odds saknas'. Edge >5%-enheter = värdespel.",
                    },
                    lineupNotes: { type: "string" },
                    lineupValueShift: {
                      type: "string",
                      enum: ["ökat", "minskat", "oförändrat", "okänt"],
                    },
                    matchAnalysis: {
                      type: "object",
                      description: "Strukturerad betting-checklista på svenska",
                      properties: {
                        grundlaggande: { type: "string" },
                        btts: { type: "string" },
                        oneXtwo: { type: "string" },
                        h2h: { type: "string" },
                        lagnyheter: { type: "string" },
                        ovrigt: { type: "string" },
                      },
                      required: [
                        "grundlaggande",
                        "btts",
                        "oneXtwo",
                        "h2h",
                        "lagnyheter",
                        "ovrigt",
                      ],
                    },
                  },
                  required: [
                    "homeWinPct", "drawPct", "awayWinPct", "predictedScore",
                    "confidence", "keyFactors", "bettingTip",
                    "bttsCall", "bttsReason", "valueBet",
                    "lineupNotes", "lineupValueShift", "matchAnalysis",
                  ],
                },
              },
            },
          ],
          tool_choice: { type: "function", function: { name: "submit_prediction" } },
        }),
      });

    let res = await callAI("google/gemini-3-flash-preview");
    if (!res.ok && res.status !== 429 && res.status !== 402) {
      // Fallback to a known-stable model if the primary one fails.
      res = await callAI("google/gemini-2.5-flash");
    }

    if (res.status === 429)
      throw new Error("För många förfrågningar — försök igen om en stund.");
    if (res.status === 402)
      throw new Error("AI-krediter slut — fyll på i Lovable Cloud-inställningar.");
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error("AI gateway error", res.status, body.slice(0, 500));
      throw new Error(`AI-fel: ${res.status}`);
    }

    const json: any = await res.json();
    let args = json?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
    if (!args) {
      // Some models return JSON inside content instead of a tool call.
      const content: string | undefined = json?.choices?.[0]?.message?.content;
      const match = content?.match(/\{[\s\S]*\}/);
      if (match) args = match[0];
    }
    if (!args) {
      console.error("Ogiltigt AI-svar", JSON.stringify(json).slice(0, 500));
      throw new Error("Ogiltigt AI-svar — modellen returnerade inget verktygsanrop.");
    }
    const parsed = JSON.parse(args) as {
      homeWinPct: number;
      drawPct: number;
      awayWinPct: number;
      predictedScore: string;
      confidence: "låg" | "medel" | "hög";
      keyFactors: string[];
      bettingTip: string;
      bttsCall: "ja" | "nej" | "osäker";
      bttsReason: string;
      valueBet: string;
      lineupNotes: string;
      lineupValueShift: "ökat" | "minskat" | "oförändrat" | "okänt";
      matchAnalysis: MatchAnalysisSections;
    };

    // Post-hoc kalibrering (historisk bias, Brier, baseline) — viktigare än ren AI-träff.
    const calAdj = calibrationToAdjustments(calibration);
    const calibrated = applyCalibrationAdjustments(
      {
        homeWinPct: Number(parsed.homeWinPct) || 33,
        drawPct: Number(parsed.drawPct) || 34,
        awayWinPct: Number(parsed.awayWinPct) || 33,
      },
      calAdj,
    );
    parsed.homeWinPct = calibrated.homeWinPct;
    parsed.drawPct = calibrated.drawPct;
    parsed.awayWinPct = calibrated.awayWinPct;
    parsed.predictedScore = fixScoreCoherence(
      parsed.predictedScore,
      parsed.homeWinPct,
      parsed.drawPct,
      parsed.awayWinPct,
    );
    parsed.confidence = deriveConfidence(
      parsed.homeWinPct,
      parsed.drawPct,
      parsed.awayWinPct,
    );

    // BTTS alltid från statistikmodellen — samma som enskild match & dagens tips
    parsed.bttsCall = statBaseline.bttsCall;
    parsed.bttsReason = statBaseline.bttsReason;
    if (!parsed.matchAnalysis && statBaseline.matchAnalysis) {
      parsed.matchAnalysis = statBaseline.matchAnalysis;
    }
    if (parsed.matchAnalysis && preMatchChecklist) {
      const bttsFallback = buildBttsAnalysisSection({
        homeName: data.homeName,
        awayName: data.awayName,
        checklist: preMatchChecklist,
        homeGoalStats,
        awayGoalStats,
        homeStanding: homeStanding?.played
          ? { played: homeStanding.played, gf: homeStanding.gf, ga: homeStanding.ga }
          : undefined,
        awayStanding: awayStanding?.played
          ? { played: awayStanding.played, gf: awayStanding.gf, ga: awayStanding.ga }
          : undefined,
        bttsCall: parsed.bttsCall,
        bttsReason: parsed.bttsReason,
      });
      parsed.matchAnalysis = ensureMatchAnalysisBtts(parsed.matchAnalysis, bttsFallback);
    }
    parsed.predictedScore = fixBttsScoreCoherence(
      parsed.predictedScore,
      parsed.bttsCall,
      parsed.homeWinPct,
      parsed.drawPct,
      parsed.awayWinPct,
    );

    // Spara tipset för framtida lärande (best-effort).
    savePrediction({
      leagueId: data.leagueId,
      homeId: data.homeId,
      awayId: data.awayId,
      homeName: data.homeName,
      awayName: data.awayName,
      eventId: lineups.eventId ?? null,
      eventDate: lineups.eventDate ?? null,
      homeWinPct: parsed.homeWinPct,
      drawPct: parsed.drawPct,
      awayWinPct: parsed.awayWinPct,
      predictedScore: parsed.predictedScore,
      confidence: parsed.confidence,
      bettingTip: parsed.bettingTip,
      keyFactors: parsed.keyFactors,
      lineupReleased: lineups.released,
      round: data.round ?? null,
      bttsCall: parsed.bttsCall,
      bttsReason: parsed.bttsReason,
      matchAnalysis: parsed.matchAnalysis ?? null,
    }).catch((e) => console.error("savePrediction error", e));


    return {
      ...parsed,
      source: "ai" as const,
      lineupReleased: lineups.released,
      missingHome,
      missingAway,
      marketOdds: marketOdds
        ? {
            decimalOdds: marketOdds.decimalOdds,
            marketProbPct: marketOdds.marketProbPct,
            books: marketOdds.providers,
          }
        : null,
    };
}

export const predictMatch = createServerFn({ method: "POST" })
  .inputValidator((d: z.infer<typeof predictMatchInputSchema>) =>
    predictMatchInputSchema.parse(d),
  )
  .handler(async ({ data }) => generateMatchPrediction(data));
