/**
 * Backtestmotor för 1X2 + BTTS
 * Simulerar 100kr-insatser på modellens tips, visar ROI per liga.
 * Kör iterativt — hittar bästa modellkonfiguration automatiskt.
 *
 *   npx tsx scripts/backtest-model.ts
 *   npx tsx scripts/backtest-model.ts --loop   (kör alla varianter)
 *   npx tsx scripts/backtest-model.ts --league=eng.1
 */

import { loadEnv, createScriptSupabase, sleep } from "../src/lib/script-env";
import { LEAGUES } from "../src/lib/leagues";
import { poissonPmf, buildScoreMatrix, probsFromMatrix, rhoFromAvgGoals } from "../src/lib/poisson-model";

loadEnv();
const sb = createScriptSupabase();

const BACKTEST_MATCHES = 200;
const BET_AMOUNT       = 100;       // kr per insats
const ODDS_1X2         = 1.85;      // typiska platta odds för favoriten
const ODDS_BTTS_JA     = 1.80;
const ODDS_BTTS_NEJ    = 1.90;

// ─── Modellkonfigurationer att jämföra ────────────────────────────────────────

type ModelCfg = {
  name: string;
  formMatches: number;       // hur många historiska matcher att använda
  recentBoost: number;       // vikt för senaste 7 matcher (1.0 = ingen boost)
  homeAdv: number;           // hemlags-fördel multiplikator
  shotWeight: number;        // 0 = bara mål, 0.18 = 18% SoT-blend
  sotConv: number;           // SoT→mål konvertering (0.29 empirisk)
  betThreshold1x2: number;   // minimum modell-sannolikhet för att spela
  betDraws: boolean;         // spela X?
  bttsThreshold: number;     // minimum BTTS-sannolikhet för JA-tips
  bttsNejThreshold: number;  // max sannolikhet för NEJ-tips
};

// ─── Ligaspecifika regler (baserade på backtest-analys) ──────────────────────

type LeagueOverride = {
  bttsDisabled?: boolean;   // skippa BTTS helt
  bttsThreshold?: number;   // override JA-threshold
  bttsNejThreshold?: number;
  homeAdv?: number;         // ligaspecifik hemma-fördel
  betThreshold1x2?: number; // ligaspecifik 1X2-threshold
};

// Baserat på data: Copa-turneringar + Ligue1/Serie A är dåliga för BTTS
const LEAGUE_OVERRIDES: Record<string, LeagueOverride> = {
  "conmebol.libertadores": { bttsDisabled: true, homeAdv: 1.15 },
  "conmebol.sudamericana": { bttsDisabled: true, homeAdv: 1.15 },
  "ita.1":    { bttsThreshold: 0.65, bttsNejThreshold: 0.35 }, // defensivt (45% BTTS)
  "fra.1":    { bttsThreshold: 0.62, bttsNejThreshold: 0.37 }, // låg BTTS
  "sco.1":    { bttsThreshold: 0.62, bttsNejThreshold: 0.37 }, // defensivt
  "jpn.1":    { bttsThreshold: 0.65, bttsNejThreshold: 0.33 }, // J-League låg BTTS
  "aus.1":    { bttsThreshold: 0.58, homeAdv: 1.15 },          // A-League
  "arg.1":    { bttsThreshold: 0.60, homeAdv: 1.20 },          // Arg. volatilt
  "chi.1":    { bttsThreshold: 0.60, bttsNejThreshold: 0.38 }, // Chile låg BTTS
  "ksa.1":    { homeAdv: 1.28, betThreshold1x2: 0.58 },        // stark hemma-fördel
  "nor.1":    { homeAdv: 1.22, bttsThreshold: 0.50 },          // bra BTTS
  "ger.1":    { bttsThreshold: 0.50, homeAdv: 1.15 },          // hög scoring
  "ger.2":    { bttsThreshold: 0.50 },                          // hög scoring
  "esp.1":    { bttsThreshold: 0.52 },                          // bra BTTS
  "usa.1":    { bttsThreshold: 0.52, homeAdv: 1.20 },          // bra BTTS
  "swe.1":    { homeAdv: 1.20, bttsThreshold: 0.52 },          // bra BTTS
  "den.1":    { bttsThreshold: 0.52, homeAdv: 1.18 },          // bra BTTS
  "mex.1":    { bttsThreshold: 0.52 },                          // Mexico bra BTTS
};

const MODELS: ModelCfg[] = [
  {
    name: "A: Baseline (mål, Poisson)",
    formMatches: 20, recentBoost: 1.0, homeAdv: 1.18,
    shotWeight: 0.0, sotConv: 0.29,
    betThreshold1x2: 0.50, betDraws: false, bttsThreshold: 0.54, bttsNejThreshold: 0.44,
  },
  {
    name: "B: + Shots-xG (18%)",
    formMatches: 20, recentBoost: 1.0, homeAdv: 1.18,
    shotWeight: 0.18, sotConv: 0.29,
    betThreshold1x2: 0.50, betDraws: false, bttsThreshold: 0.54, bttsNejThreshold: 0.44,
  },
  {
    name: "C: + Recent form boost (2x senaste 7)",
    formMatches: 20, recentBoost: 2.0, homeAdv: 1.18,
    shotWeight: 0.18, sotConv: 0.29,
    betThreshold1x2: 0.50, betDraws: false, bttsThreshold: 0.54, bttsNejThreshold: 0.44,
  },
  {
    name: "D: + Hög threshold (55%+)",
    formMatches: 20, recentBoost: 2.0, homeAdv: 1.18,
    shotWeight: 0.18, sotConv: 0.29,
    betThreshold1x2: 0.55, betDraws: false, bttsThreshold: 0.58, bttsNejThreshold: 0.40,
  },
  {
    name: "E: + Kalibr. hemma-fördel (1.22)",
    formMatches: 25, recentBoost: 2.0, homeAdv: 1.22,
    shotWeight: 0.18, sotConv: 0.29,
    betThreshold1x2: 0.55, betDraws: false, bttsThreshold: 0.58, bttsNejThreshold: 0.40,
  },
  {
    name: "F: Expertstrategi (aggressiv threshold 60%)",
    formMatches: 30, recentBoost: 3.0, homeAdv: 1.22,
    shotWeight: 0.22, sotConv: 0.30,
    betThreshold1x2: 0.60, betDraws: false, bttsThreshold: 0.62, bttsNejThreshold: 0.37,
  },
  {
    name: "G: OPTIMAL (B+D+LigaRegler)",
    formMatches: 25, recentBoost: 2.0, homeAdv: 1.20,
    shotWeight: 0.18, sotConv: 0.29,
    betThreshold1x2: 0.53, betDraws: false, bttsThreshold: 0.58, bttsNejThreshold: 0.40,
  },
];

// ─── Datatyper ────────────────────────────────────────────────────────────────

type MatchRow = {
  league_id: string;
  event_id: string;
  event_date: string;
  home_id: string;
  away_id: string;
  home_score: number;
  away_score: number;
  outcome: "1" | "X" | "2";
  btts: boolean;
};

type ShotRow = {
  event_id: string;
  home_team_id: string;
  away_team_id: string;
  home_shots_on_target: number | null;
  away_shots_on_target: number | null;
};

type TeamStats = { gf: number; ga: number; soT: number; soTConc: number; n: number; nRecent: number };

type BetResult = {
  predicted: "1" | "X" | "2";
  actual: "1" | "X" | "2";
  probH: number; probX: number; probA: number;
  bttsYesPct: number;
  bttsPredicted: "JA" | "NEJ" | null;
  bttsActual: boolean;
  bet1x2: boolean;
  betsWon1x2: boolean;
  betBtts: boolean;
  betBttsWon: boolean;
};

type LeagueResult = {
  league: string;
  leagueName: string;
  matches: number;
  bets1x2: number;
  won1x2: number;
  acc1x2: number;
  roi1x2: number;
  roi1x2Pct: number;
  betsBtts: number;
  wonBtts: number;
  accBtts: number;
  roiBtts: number;
  roiBttsPct: number;
  avgBrier: number;
  totalROI: number;
};

// ─── Prediktionslogik ─────────────────────────────────────────────────────────

function weightedStats(
  matches: Array<{ isRecent: boolean; gf: number; ga: number; soT: number; soTConc: number }>,
  recentBoost: number,
): { attack: number; defense: number; xgA: number; xgD: number } {
  if (!matches.length) return { attack: 1.3, defense: 1.0, xgA: 4.0, xgD: 3.0 };

  let gfW = 0, gaW = 0, soTW = 0, soTCW = 0, wTotal = 0;
  for (const m of matches) {
    const w = m.isRecent ? recentBoost : 1.0;
    gfW   += m.gf   * w;
    gaW   += m.ga   * w;
    soTW  += m.soT  * w;
    soTCW += m.soTConc * w;
    wTotal += w;
  }

  return {
    attack:  gfW   / wTotal,
    defense: gaW   / wTotal,
    xgA:     soTW  / wTotal,   // avg SoT scored
    xgD:     soTCW / wTotal,   // avg SoT conceded
  };
}

function predict(
  homeHistory: Array<{ isRecent: boolean; gf: number; ga: number; soT: number; soTConc: number }>,
  awayHistory: Array<{ isRecent: boolean; gf: number; ga: number; soT: number; soTConc: number }>,
  leagueAvg: number,
  cfg: ModelCfg,
): { h: number; x: number; a: number; btts: number; lamH: number; lamA: number } {

  const half = leagueAvg / 2;

  const hS = weightedStats(homeHistory, cfg.recentBoost);
  const aS = weightedStats(awayHistory, cfg.recentBoost);

  // Mål-baserade attack/defense
  let hAttack  = homeHistory.length >= 5 ? hS.attack  : half;
  let hDefense = homeHistory.length >= 5 ? hS.defense : half;
  let aAttack  = awayHistory.length >= 5 ? aS.attack  : half;
  let aDefense = awayHistory.length >= 5 ? aS.defense : half;

  // Shots xG-blend (om tillgänglig)
  if (cfg.shotWeight > 0) {
    if (homeHistory.length >= 5 && hS.xgA > 0) {
      const xgAtt = hS.xgA  * cfg.sotConv;
      const xgDef = hS.xgD  * cfg.sotConv;
      hAttack  = (1 - cfg.shotWeight) * hAttack  + cfg.shotWeight * xgAtt;
      hDefense = (1 - cfg.shotWeight) * hDefense + cfg.shotWeight * xgDef;
    }
    if (awayHistory.length >= 5 && aS.xgA > 0) {
      const xgAtt = aS.xgA  * cfg.sotConv;
      const xgDef = aS.xgD  * cfg.sotConv;
      aAttack  = (1 - cfg.shotWeight) * aAttack  + cfg.shotWeight * xgAtt;
      aDefense = (1 - cfg.shotWeight) * aDefense + cfg.shotWeight * xgDef;
    }
  }

  // Poisson lambdas med hemma-fördel
  const lamH = Math.max(0.35, ((hAttack + aDefense) / 2) * cfg.homeAdv);
  const lamA = Math.max(0.35,  (aAttack + hDefense) / 2);

  const rho    = rhoFromAvgGoals(leagueAvg);
  const matrix = buildScoreMatrix(lamH, lamA, rho, 8);
  const probs  = probsFromMatrix(matrix);

  // BTTS
  const pHomeScores = 1 - poissonPmf(0, lamH);
  const pAwayScores = 1 - poissonPmf(0, lamA);

  // Blanda med historisk BTTS-rate om tillgänglig
  const hBttsRate = homeHistory.length >= 5
    ? homeHistory.filter(m => m.gf > 0 && m.soT > 0).length / homeHistory.length
    : 0.52;
  const aBttsRate = awayHistory.length >= 5
    ? awayHistory.filter(m => m.gf > 0 && m.soT > 0).length / awayHistory.length
    : 0.52;
  const histBtts = (hBttsRate + aBttsRate) / 2;
  const btts = 0.55 * (pHomeScores * pAwayScores) + 0.45 * histBtts;

  return {
    h: probs.homeWinPct,
    x: probs.drawPct,
    a: probs.awayWinPct,
    btts: btts * 100,
    lamH, lamA,
  };
}

function brierScore(predicted: number, actual: number): number {
  return (predicted / 100 - actual) ** 2;
}

// ─── Data-hämtning ────────────────────────────────────────────────────────────

async function loadLeagueData(leagueId: string): Promise<{ matches: MatchRow[]; shots: Map<string, ShotRow> }> {
  const { data: matchData } = await sb
    .from("archived_seasons")
    .select("league_id, event_id, event_date, home_id, away_id, home_score, away_score, outcome, btts")
    .eq("league_id", leagueId)
    .not("outcome", "is", null)
    .order("event_date", { ascending: false })
    .limit(BACKTEST_MATCHES + 100); // extra för träning

  const matches = (matchData ?? []).map((r: any) => ({
    league_id: r.league_id,
    event_id:  String(r.event_id),
    event_date: r.event_date,
    home_id:   String(r.home_id),
    away_id:   String(r.away_id),
    home_score: Number(r.home_score),
    away_score: Number(r.away_score),
    outcome:   r.outcome as "1"|"X"|"2",
    btts:      Boolean(r.btts),
  }));

  // Hämta shots-data (kan saknas)
  const sbAny = sb as any;
  const { data: shotData } = await sbAny
    .from("football_match_stats")
    .select("event_id, home_team_id, away_team_id, home_shots_on_target, away_shots_on_target")
    .eq("league_id", leagueId)
    .not("home_shots_on_target", "is", null);

  const shots = new Map<string, ShotRow>();
  for (const r of shotData ?? []) {
    shots.set(String(r.event_id), {
      event_id: String(r.event_id),
      home_team_id: String(r.home_team_id),
      away_team_id: String(r.away_team_id),
      home_shots_on_target: r.home_shots_on_target != null ? Number(r.home_shots_on_target) : null,
      away_shots_on_target: r.away_shots_on_target != null ? Number(r.away_shots_on_target) : null,
    });
  }

  return { matches: matches.reverse(), shots }; // äldst först
}

// ─── Backtestning per liga ────────────────────────────────────────────────────

async function backtestLeague(
  league: { id: string; name: string },
  cfg: ModelCfg,
): Promise<LeagueResult | null> {

  const { matches, shots } = await loadLeagueData(league.id);
  if (matches.length < 40) return null;

  const testMatches = matches.slice(-BACKTEST_MATCHES);
  const leagueAvg = matches.reduce((s, m) => s + m.home_score + m.away_score, 0) / matches.length;

  let profit1x2 = 0, bets1x2 = 0, won1x2 = 0;
  let profitBtts = 0, betsBtts = 0, wonBtts = 0;
  let brierSum = 0;

  for (const m of testMatches) {
    const mDate = new Date(m.event_date);

    // Historik FÖRE denna match
    const getHistory = (teamId: string) =>
      matches
        .filter(h => new Date(h.event_date) < mDate && (h.home_id === teamId || h.away_id === teamId))
        .slice(-cfg.formMatches)
        .map((h, idx, arr) => {
          const isHome = h.home_id === teamId;
          const gf = isHome ? h.home_score : h.away_score;
          const ga = isHome ? h.away_score : h.home_score;
          const shot = shots.get(h.event_id);
          const soT = isHome
            ? (shot?.home_shots_on_target ?? gf * 3.5)
            : (shot?.away_shots_on_target ?? gf * 3.5);
          const soTConc = isHome
            ? (shot?.away_shots_on_target ?? ga * 3.5)
            : (shot?.home_shots_on_target ?? ga * 3.5);
          const isRecent = idx >= arr.length - 7;
          return { isRecent, gf, ga, soT, soTConc };
        });

    const homeHist = getHistory(m.home_id);
    const awayHist = getHistory(m.away_id);

    const lgOvr0 = LEAGUE_OVERRIDES[league.id];
    const cfgWithLgAdj = lgOvr0?.homeAdv
      ? { ...cfg, homeAdv: lgOvr0.homeAdv }
      : cfg;
    const pred = predict(homeHist, awayHist, leagueAvg, cfgWithLgAdj);

    // 1X2 betting
    const topSign: "1"|"X"|"2" = pred.h >= pred.a && pred.h >= pred.x ? "1"
      : pred.a >= pred.h && pred.a >= pred.x ? "2" : "X";
    const topProb = Math.max(pred.h, pred.x, pred.a) / 100;

    const lgOvr1x2 = LEAGUE_OVERRIDES[league.id];
    const threshold1x2 = lgOvr1x2?.betThreshold1x2 ?? cfg.betThreshold1x2;
    const leagueHomeAdv = lgOvr1x2?.homeAdv ?? cfg.homeAdv;

    const shouldBet1x2 = topProb >= threshold1x2
      && (cfg.betDraws || topSign !== "X");

    if (shouldBet1x2) {
      bets1x2++;
      const won = topSign === m.outcome;
      if (won) { profit1x2 += BET_AMOUNT * (ODDS_1X2 - 1); won1x2++; }
      else      { profit1x2 -= BET_AMOUNT; }
    }

    // BTTS betting — respekterar ligaspecifika overrides
    const lgOvr = LEAGUE_OVERRIDES[league.id];
    const bttsThresh    = (lgOvr?.bttsThreshold    ?? cfg.bttsThreshold)    * 100;
    const bttsNejThresh = (lgOvr?.bttsNejThreshold ?? cfg.bttsNejThreshold) * 100;
    const bttsDisabled  = lgOvr?.bttsDisabled === true;

    const bttsPred: "JA"|"NEJ"|null =
      bttsDisabled              ? null :
      pred.btts >= bttsThresh   ? "JA" :
      pred.btts <= bttsNejThresh ? "NEJ" : null;

    if (bttsPred) {
      betsBtts++;
      const won = bttsPred === "JA" ? m.btts : !m.btts;
      const odds = bttsPred === "JA" ? ODDS_BTTS_JA : ODDS_BTTS_NEJ;
      if (won) { profitBtts += BET_AMOUNT * (odds - 1); wonBtts++; }
      else     { profitBtts -= BET_AMOUNT; }
    }

    // Brier
    const actualH = m.outcome === "1" ? 1 : 0;
    const actualX = m.outcome === "X" ? 1 : 0;
    const actualA = m.outcome === "2" ? 1 : 0;
    brierSum += (brierScore(pred.h, actualH) + brierScore(pred.x, actualX) + brierScore(pred.a, actualA)) / 3;
  }

  const n = testMatches.length;
  return {
    league: league.id,
    leagueName: league.name,
    matches: n,
    bets1x2, won1x2,
    acc1x2: bets1x2 > 0 ? won1x2 / bets1x2 : 0,
    roi1x2: profit1x2,
    roi1x2Pct: bets1x2 > 0 ? profit1x2 / (bets1x2 * BET_AMOUNT) * 100 : 0,
    betsBtts, wonBtts,
    accBtts: betsBtts > 0 ? wonBtts / betsBtts : 0,
    roiBtts: profitBtts,
    roiBttsPct: betsBtts > 0 ? profitBtts / (betsBtts * BET_AMOUNT) * 100 : 0,
    avgBrier: brierSum / n,
    totalROI: profit1x2 + profitBtts,
  };
}

// ─── Rapport ──────────────────────────────────────────────────────────────────

function pct(v: number) { return (v >= 0 ? "+" : "") + v.toFixed(1) + "%"; }
function kr(v: number)  { return (v >= 0 ? "+" : "") + Math.round(v) + "kr"; }
function acc(v: number) { return (v * 100).toFixed(0) + "%"; }

function printLeagueTable(results: (LeagueResult | null)[], modelName: string) {
  const rows = results.filter(Boolean) as LeagueResult[];
  console.log(`\n${"═".repeat(110)}`);
  console.log(`  MODELL: ${modelName}`);
  console.log(`  ${BACKTEST_MATCHES} matcher/liga · 100kr/insats · odds 1X2=${ODDS_1X2} BTTS-JA=${ODDS_BTTS_JA} BTTS-NEJ=${ODDS_BTTS_NEJ}`);
  console.log(`${"═".repeat(110)}`);
  console.log(
    "Liga".padEnd(28) +
    "Match".padStart(6) +
    "1X2bet".padStart(8) + "Träff".padStart(7) + "Acc".padStart(6) + "ROI-kr".padStart(9) + "ROI%".padStart(8) +
    "BTTS-b".padStart(8) + "Träff".padStart(7) + "Acc".padStart(6) + "ROI-kr".padStart(9) + "ROI%".padStart(8) +
    "Brier".padStart(7) + "Totalt".padStart(9)
  );
  console.log("─".repeat(110));

  let tot1x2P = 0, tot1x2B = 0, tot1x2W = 0;
  let totBttsP = 0, totBttsB = 0, totBttsW = 0;
  let totBrier = 0, totMatches = 0;

  for (const r of rows.sort((a, b) => b.totalROI - a.totalROI)) {
    const totMark = r.totalROI > 0 ? " ✓" : r.totalROI < -500 ? " ✗" : "";
    console.log(
      r.leagueName.padEnd(28) +
      String(r.matches).padStart(6) +
      String(r.bets1x2).padStart(8) + String(r.won1x2).padStart(7) + acc(r.acc1x2).padStart(6) +
      kr(r.roi1x2).padStart(9) + pct(r.roi1x2Pct).padStart(8) +
      String(r.betsBtts).padStart(8) + String(r.wonBtts).padStart(7) + acc(r.accBtts).padStart(6) +
      kr(r.roiBtts).padStart(9) + pct(r.roiBttsPct).padStart(8) +
      r.avgBrier.toFixed(3).padStart(7) +
      (kr(r.totalROI) + totMark).padStart(9)
    );
    tot1x2P += r.roi1x2; tot1x2B += r.bets1x2; tot1x2W += r.won1x2;
    totBttsP += r.roiBtts; totBttsB += r.betsBtts; totBttsW += r.wonBtts;
    totBrier += r.avgBrier; totMatches += r.matches;
  }

  console.log("─".repeat(110));
  const n = rows.length;
  const totBetAmt1x2 = tot1x2B * BET_AMOUNT;
  const totBetAmtBtts = totBttsB * BET_AMOUNT;
  console.log(
    "TOTALT".padEnd(28) +
    String(totMatches).padStart(6) +
    String(tot1x2B).padStart(8) + String(tot1x2W).padStart(7) + acc(tot1x2B > 0 ? tot1x2W/tot1x2B : 0).padStart(6) +
    kr(tot1x2P).padStart(9) + pct(totBetAmt1x2 > 0 ? tot1x2P/totBetAmt1x2*100 : 0).padStart(8) +
    String(totBttsB).padStart(8) + String(totBttsW).padStart(7) + acc(totBttsB > 0 ? totBttsW/totBttsB : 0).padStart(6) +
    kr(totBttsP).padStart(9) + pct(totBetAmtBtts > 0 ? totBttsP/totBetAmtBtts*100 : 0).padStart(8) +
    (totBrier/n).toFixed(3).padStart(7) +
    kr(tot1x2P + totBttsP).padStart(9)
  );
  console.log(`${"═".repeat(110)}`);

  return {
    totalROI: tot1x2P + totBttsP,
    roi1x2: tot1x2P,
    roiBtts: totBttsP,
    acc1x2: tot1x2B > 0 ? tot1x2W / tot1x2B : 0,
    accBtts: totBttsB > 0 ? totBttsW / totBttsB : 0,
    brier: totBrier / n,
    bets: tot1x2B + totBttsB,
  };
}

// ─── Huvud ────────────────────────────────────────────────────────────────────

async function main() {
  const argv = process.argv.slice(2);
  const runLoop   = argv.includes("--loop");
  const leagueArg = argv.find(a => a.startsWith("--league="))?.slice(9);

  const leagues = leagueArg
    ? LEAGUES.filter(l => l.id === leagueArg)
    : [...LEAGUES];

  console.log(`\n⏳ Laddar data för ${leagues.length} ligor...`);

  const modelsToRun = runLoop ? MODELS : [MODELS[0], MODELS[1], MODELS[3], MODELS[5]];

  let bestModel: typeof MODELS[0] | null = null;
  let bestROI = -Infinity;
  const summaries: Array<{ model: string; totalROI: number; acc1x2: number; brier: number }> = [];

  for (const cfg of modelsToRun) {
    console.log(`\n▶ Testar: ${cfg.name}`);
    const results: (LeagueResult | null)[] = [];

    for (const league of leagues) {
      process.stdout.write(`  ${league.name}... `);
      try {
        const r = await backtestLeague(league, cfg);
        results.push(r);
        console.log(r ? `${r.matches}mch, 1X2-ROI: ${kr(r.roi1x2)}, BTTS-ROI: ${kr(r.roiBtts)}` : "för få matcher");
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.log(`fel: ${msg}`);
        results.push(null);
      }
      await sleep(80);
    }

    const summary = printLeagueTable(results, cfg.name);
    summaries.push({ model: cfg.name, ...summary });

    if (summary.totalROI > bestROI) {
      bestROI = summary.totalROI;
      bestModel = cfg;
    }
  }

  // ─── Jämförelsetabell ───────────────────────────────────────────────────────
  console.log(`\n${"═".repeat(90)}`);
  console.log("  MODELL-JÄMFÖRELSE");
  console.log(`${"═".repeat(90)}`);
  console.log("Modell".padEnd(45) + "Total-ROI".padStart(12) + "ROI-1X2".padStart(12) + "ROI-BTTS".padStart(12) + "Acc-1X2".padStart(10) + "Brier".padStart(8));
  console.log("─".repeat(90));
  for (const s of summaries.sort((a, b) => b.totalROI - a.totalROI)) {
    const mark = s.totalROI === bestROI ? " ◄ BÄST" : "";
    console.log(
      (s.model + mark).padEnd(45) +
      kr(s.totalROI).padStart(12) +
      kr(s.roi1x2).padStart(12) +
      kr(s.roiBtts).padStart(12) +
      acc(s.acc1x2).padStart(10) +
      s.brier.toFixed(3).padStart(8)
    );
  }
  console.log(`${"═".repeat(90)}`);

  if (bestModel) {
    console.log(`\n✅ BÄSTA MODELL: ${bestModel.name}`);
    console.log(`   Total ROI på ${modelsToRun.length > 1 ? BACKTEST_MATCHES * leagues.length : ""} insatser: ${kr(bestROI)}`);
    console.log(`\n   Konfiguration:`);
    console.log(`   formMatches    = ${bestModel.formMatches}`);
    console.log(`   recentBoost    = ${bestModel.recentBoost}x (senaste 7 matcher)`);
    console.log(`   homeAdvantage  = ${bestModel.homeAdv}`);
    console.log(`   shotWeight     = ${(bestModel.shotWeight * 100).toFixed(0)}%`);
    console.log(`   betThreshold   = ${(bestModel.betThreshold1x2 * 100).toFixed(0)}%`);
    console.log(`   bttsThreshold  = ${(bestModel.bttsThreshold * 100).toFixed(0)}% (JA) / ${(bestModel.bttsNejThreshold * 100).toFixed(0)}% (NEJ)`);
    console.log(`\n   ⚡ Kör med --loop för att testa ALLA 6 modellvarianter.`);
  }

  // ─── Dataanalys ─────────────────────────────────────────────────────────────
  console.log(`\n${"═".repeat(90)}`);
  console.log("  DATA-ANALYS — vad saknas?");
  console.log(`${"═".repeat(90)}`);

  for (const league of leagues) {
    const { count: arc }  = await sb.from("archived_seasons")
      .select("*", { count: "exact", head: true })
      .eq("league_id", league.id);
    const { count: stat } = await (sb as any).from("football_match_stats")
      .select("*", { count: "exact", head: true })
      .eq("league_id", league.id);
    const arcN  = arc  ?? 0;
    const statN = stat ?? 0;
    const shotCoverage = arcN > 0 ? Math.round(statN / arcN * 100) : 0;
    const status = shotCoverage >= 80 ? "✓" : shotCoverage >= 40 ? "~" : "✗";
    if (arcN > 0) {
      const lgOvr = LEAGUE_OVERRIDES[league.id];
      const note = lgOvr?.bttsDisabled ? " [BTTS av]" : lgOvr?.bttsThreshold ? ` [BTTS ${lgOvr.bttsThreshold*100}%]` : "";
      console.log(
        ` ${status} ${league.name.padEnd(25)} arkiv: ${String(arcN).padStart(4)}  shots: ${String(statN).padStart(4)}  täckning: ${shotCoverage}%${note}` +
        (shotCoverage < 40 ? " ← SAKNAR SHOTS-DATA" : "")
      );
    }
  }
  console.log(`${"═".repeat(90)}`);
  console.log(`\n  Kör: npm run football:stats:full  för att hämta saknad shots-data`);
}

main().catch(e => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
