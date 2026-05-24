import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  mergePreliminaryPostmortem,
  PREDICTION_MODEL_VERSION,
  extractBtts,
  type BttsCall,
} from "./prediction-meta";
import { espnGet, summaryUrl } from "./espn.api";
import { brierScore, outcomeToTip } from "./match-outcome";
import { pickOutcome } from "./poisson-model";

export type PredictionRow = {
  id: string;
  league_id: string;
  home_id: string;
  away_id: string;
  home_name: string;
  away_name: string;
  event_id: string | null;
  event_date: string | null;
  home_win_pct: number;
  draw_pct: number;
  away_win_pct: number;
  predicted_score: string;
  predicted_outcome: string;
  confidence: string;
  betting_tip: string | null;
  key_factors: string[] | null;
  lineup_released: boolean | null;
  actual_home_score: number | null;
  actual_away_score: number | null;
  actual_outcome: string | null;
  brier_score: number | null;
  resolved_at: string | null;
  created_at: string;
  postmortem?: Postmortem | null;
};

export type Postmortem = {
  verdict: "right" | "wrong";
  exactScore: boolean;
  summary: string; // 1-2 meningar varför det blev som det blev
  why: string[]; // 2-4 punkter med statistik/logik som förklarar utfallet
  luck: {
    level: "låg" | "medel" | "hög";
    reason: string; // ex. "sent vinstmål från hörna", "missad straff", "rött kort vände matchen"
  };
  lessons: string[]; // 1-3 konkreta lärdomar inför framtida tippningar
  // Djupare analys när modellen hade fel:
  model_mistakes?: string[]; // konkreta felbedömningar modellen gjorde
  signals_missed?: string[]; // signaler/data modellen borde vägt tyngre
  alternative_pick?: string; // vad modellen borde tippat istället, med kort motivering
  match_stats?: {
    shots?: { home: number; away: number };
    shotsOnTarget?: { home: number; away: number };
    possession?: { home: number; away: number };
    xg?: { home: number; away: number };
    redCards?: { home: number; away: number };
  };
  generated_at: string;
  model: string;
};

export type SavePredictionInput = {
  leagueId: string;
  homeId: string;
  awayId: string;
  homeName: string;
  awayName: string;
  eventId: string | null;
  eventDate: string | null;
  homeWinPct: number;
  drawPct: number;
  awayWinPct: number;
  predictedScore: string;
  confidence: string;
  bettingTip?: string;
  keyFactors?: string[];
  lineupReleased?: boolean;
  round?: number | null;
  bttsCall?: BttsCall;
  bttsReason?: string;
};

async function findOpenPredictionId(input: SavePredictionInput): Promise<{
  id: string;
  postmortem: unknown;
} | null> {
  let q = supabaseAdmin
    .from("predictions")
    .select("id, postmortem")
    .eq("league_id", input.leagueId)
    .eq("home_id", input.homeId)
    .eq("away_id", input.awayId)
    .is("actual_outcome", null)
    .order("created_at", { ascending: false })
    .limit(1);

  if (input.eventId) {
    q = q.eq("event_id", input.eventId);
  }

  const { data } = await q.maybeSingle();
  return data ?? null;
}

export async function savePrediction(input: SavePredictionInput) {
  const predicted_outcome = pickOutcome(input.homeWinPct, input.drawPct, input.awayWinPct);
  const payload = {
    league_id: input.leagueId,
    home_id: input.homeId,
    away_id: input.awayId,
    home_name: input.homeName,
    away_name: input.awayName,
    event_id: input.eventId,
    event_date: input.eventDate,
    home_win_pct: input.homeWinPct,
    draw_pct: input.drawPct,
    away_win_pct: input.awayWinPct,
    predicted_score: input.predictedScore,
    predicted_outcome,
    confidence: input.confidence,
    betting_tip: input.bettingTip ?? null,
    key_factors: input.keyFactors ?? null,
    lineup_released: input.lineupReleased ?? false,
    round: input.round ?? null,
    btts_call: input.bttsCall ?? null,
    btts_reason: input.bttsReason ?? null,
    model_version: PREDICTION_MODEL_VERSION,
    postmortem: mergePreliminaryPostmortem(null, input.bttsCall, input.bttsReason),
  };

  const existing = await findOpenPredictionId(input);
  if (existing) {
    const postmortem = mergePreliminaryPostmortem(
      existing.postmortem,
      input.bttsCall,
      input.bttsReason,
    );
    const { error } = await supabaseAdmin
      .from("predictions")
      .update({ ...payload, postmortem })
      .eq("id", existing.id);
    if (error) console.error("savePrediction update failed", error);
    return;
  }

  const { error } = await supabaseAdmin.from("predictions").insert(payload);
  if (error) console.error("savePrediction insert failed", error);
}

export type LeagueCalibration = {
  leagueId: string;
  total: number;
  resolved: number;
  hitRate: number; // andel rätt 1X2 av resolved
  avgBrier: number | null;
  byConfidence: Record<string, { n: number; hits: number }>;
  outcomeBias: { H: number; D: number; A: number }; // andel rätt per faktiskt utfall
  predictedBias: { H: number; D: number; A: number }; // andel av tips per utfall
  actualDistribution: { H: number; D: number; A: number }; // verklig fördelning av utfall i ligan
  btts: { n: number; yes: number; pct: number; avgGoals: number | null }; // Båda lagen mål-stats från avgjorda matcher
  // Per-liga lärdomar från postmortems (sista 20 felaktiga + 10 rätta)
  topLessons: string[];
  topMistakes: string[]; // återkommande model_mistakes
  topSignalsMissed: string[]; // återkommande signals_missed
  recentWrongPicks: Array<{
    home: string;
    away: string;
    predicted: string;
    actual: string;
    homePct: number;
    drawPct: number;
    awayPct: number;
    lesson: string;
  }>;
  // 3-års historisk baseline från archived_seasons (rena ligafrekvenser)
  historicalBaseline?: {
    seasons: number;
    matches: number;
    homePct: number;
    drawPct: number;
    awayPct: number;
    bttsPct: number;
    avgGoals: number;
  } | null;
};

async function fetchHistoricalBaseline(leagueId: string) {
  const { data } = await supabaseAdmin
    .from("archived_seasons")
    .select("outcome, btts, home_score, away_score, season")
    .eq("league_id", leagueId)
    .not("outcome", "is", null);
  if (!data || data.length < 20) return null;
  let H = 0, D = 0, A = 0, btts = 0, bttsN = 0, goals = 0, goalsN = 0;
  const seasons = new Set<string>();
  for (const r of data) {
    seasons.add(r.season);
    if (r.outcome === "1") H++;
    else if (r.outcome === "X") D++;
    else if (r.outcome === "2") A++;
    if (r.btts != null) { bttsN++; if (r.btts) btts++; }
    if (r.home_score != null && r.away_score != null) {
      goalsN++;
      goals += Number(r.home_score) + Number(r.away_score);
    }
  }
  const n = H + D + A || 1;
  return {
    seasons: seasons.size,
    matches: H + D + A,
    homePct: H / n,
    drawPct: D / n,
    awayPct: A / n,
    bttsPct: bttsN ? btts / bttsN : 0,
    avgGoals: goalsN ? goals / goalsN : 0,
  };
}

function topByFrequency(items: string[], k = 5): string[] {
  const counts = new Map<string, number>();
  for (const raw of items) {
    const s = (raw ?? "").trim();
    if (!s) continue;
    counts.set(s, (counts.get(s) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, k)
    .map(([s, n]) => (n > 1 ? `${s} (×${n})` : s));
}

export async function getCalibration(leagueId: string): Promise<LeagueCalibration> {
  const { data, error } = await supabaseAdmin
    .from("predictions")
    .select(
      "predicted_outcome, actual_outcome, brier_score, confidence, actual_home_score, actual_away_score, home_name, away_name, home_win_pct, draw_pct, away_win_pct, postmortem, resolved_at",
    )
    .eq("league_id", leagueId)
    .order("created_at", { ascending: false })
    .limit(500);
  const baseline = await fetchHistoricalBaseline(leagueId);
  if (error || !data) {
    return {
      leagueId,
      total: 0,
      resolved: 0,
      hitRate: 0,
      avgBrier: null,
      byConfidence: {},
      outcomeBias: { H: 0, D: 0, A: 0 },
      predictedBias: { H: 0, D: 0, A: 0 },
      actualDistribution: { H: 0, D: 0, A: 0 },
      btts: { n: 0, yes: 0, pct: 0, avgGoals: null },
      topLessons: [],
      topMistakes: [],
      topSignalsMissed: [],
      recentWrongPicks: [],
      historicalBaseline: baseline,
    };
  }
  const resolved = data.filter((r) => r.actual_outcome);
  let hits = 0;
  let brierSum = 0;
  let brierN = 0;
  const byConfidence: Record<string, { n: number; hits: number }> = {};
  const outcomeCounts = { H: 0, D: 0, A: 0 };
  const outcomeHits = { H: 0, D: 0, A: 0 };
  const predCounts = { H: 0, D: 0, A: 0 };
  let bttsN = 0;
  let bttsYes = 0;
  let goalsSum = 0;
  const lessonsAll: string[] = [];
  const mistakesAll: string[] = [];
  const signalsAll: string[] = [];
  const wrongs: LeagueCalibration["recentWrongPicks"] = [];
  for (const r of data) {
    if (r.predicted_outcome === "H" || r.predicted_outcome === "D" || r.predicted_outcome === "A") {
      predCounts[r.predicted_outcome as "H" | "D" | "A"]++;
    }
  }
  for (const r of resolved) {
    const ok = r.predicted_outcome === r.actual_outcome;
    if (ok) hits++;
    if (r.brier_score != null) {
      brierSum += Number(r.brier_score);
      brierN++;
    }
    const c = r.confidence ?? "okänd";
    byConfidence[c] ??= { n: 0, hits: 0 };
    byConfidence[c].n++;
    if (ok) byConfidence[c].hits++;
    const ao = r.actual_outcome as "H" | "D" | "A";
    outcomeCounts[ao]++;
    if (ok) outcomeHits[ao]++;
    const hs = r.actual_home_score;
    const as = r.actual_away_score;
    if (hs != null && as != null) {
      bttsN++;
      goalsSum += Number(hs) + Number(as);
      if (Number(hs) > 0 && Number(as) > 0) bttsYes++;
    }
    const pm = (r.postmortem as any) ?? null;
    if (pm && !pm.preliminary) {
      if (Array.isArray(pm.lessons)) lessonsAll.push(...pm.lessons.map(String));
      if (Array.isArray(pm.model_mistakes)) mistakesAll.push(...pm.model_mistakes.map(String));
      if (Array.isArray(pm.signals_missed)) signalsAll.push(...pm.signals_missed.map(String));
      if (!ok && wrongs.length < 6) {
        wrongs.push({
          home: r.home_name,
          away: r.away_name,
          predicted: r.predicted_outcome,
          actual: r.actual_outcome as string,
          homePct: Number(r.home_win_pct),
          drawPct: Number(r.draw_pct),
          awayPct: Number(r.away_win_pct),
          lesson: Array.isArray(pm.lessons) && pm.lessons[0] ? String(pm.lessons[0]) : String(pm.summary ?? ""),
        });
      }
    }
  }
  const nRes = resolved.length || 1;
  return {
    leagueId,
    total: data.length,
    resolved: resolved.length,
    hitRate: resolved.length ? hits / resolved.length : 0,
    avgBrier: brierN ? brierSum / brierN : null,
    byConfidence,
    outcomeBias: {
      H: outcomeCounts.H ? outcomeHits.H / outcomeCounts.H : 0,
      D: outcomeCounts.D ? outcomeHits.D / outcomeCounts.D : 0,
      A: outcomeCounts.A ? outcomeHits.A / outcomeCounts.A : 0,
    },
    predictedBias: {
      H: data.length ? predCounts.H / data.length : 0,
      D: data.length ? predCounts.D / data.length : 0,
      A: data.length ? predCounts.A / data.length : 0,
    },
    actualDistribution: {
      H: outcomeCounts.H / nRes,
      D: outcomeCounts.D / nRes,
      A: outcomeCounts.A / nRes,
    },
    btts: {
      n: bttsN,
      yes: bttsYes,
      pct: bttsN ? bttsYes / bttsN : 0,
      avgGoals: bttsN ? goalsSum / bttsN : null,
    },
    topLessons: topByFrequency(lessonsAll, 6),
    topMistakes: topByFrequency(mistakesAll, 5),
    topSignalsMissed: topByFrequency(signalsAll, 5),
    recentWrongPicks: wrongs,
    historicalBaseline: baseline,
  };
}



// ============================================================
// HÅRDA LIGASPECIFIKA REGLER — destillerade från postmortem-analys
// ============================================================
// Dessa läggs ALLTID till oavsett om vi har resolved-data eller ej.
// Uppdateras manuellt när nya mönster upptäcks via DB-analys.
const LEAGUE_HARD_RULES: Record<string, string[]> = {
  "fra.1": [
    "LIGUE 1 — SÄSONGSAVSLUTNING: 14 av 16 senaste tipsen blev FEL. Klassiska missar: Lille hemma 73% → 0-2 mot Auxerre, Nice 75% hemma → 0-0 mot Metz, Lyon 55% hemma → 0-4 mot Lens.",
    "REGEL FRA.1 — 'Omotiverad favorit'-fällan: när hemmafavoriten redan är säkrad (Champions League, Europa, säker plats) och bortalaget kämpar (nedflyttning eller Europaplats inom räckhåll) → DRA NED hemmaPct med 10-15 enheter och flytta till D eller A. Detta är den enskilt vanligaste felkällan i Ligue 1.",
    "REGEL FRA.1 — xPts-regression OVERFITTING: när bortalaget har 'underpresterat' (negativt luckIndex) tolka det INTE som att de plötsligt levererar borta mot topplag. Värdera faktisk bortaform (last5OnRoad) över xPts-regression i Frankrike.",
    "REGEL FRA.1 — Defensiva avbräck i hemmalaget: vikta absenceScore TUNGT för backar/målvakt. Saknad ordinarie back i hemmalaget = sänk hemmaPct 8-10 enheter, inte 3.",
    "REGEL FRA.1 — Smala hemmafavoriter (homePct 45-55%) i avslutningen → tippa hellre X. Marknaden överskattar konsekvent hemmaplansfördel i Ligue 1.",
  ],
  "swe.1": [
    "ALLSVENSKAN — XG_REAL-FÄLLAN: 4 av 5 senaste fel var Djurgården-hemmatips där modellen övervärderade deras xG_real (15) som 'otur' och förväntade regression. Sirius vann ändå borta.",
    "REGEL SWE.1 — xG_real är INTE ett deterministiskt mått: höga xG_real utan att lyckas omsätta i mål senaste 3-4 matcherna betyder ofta KLINISK SVAGHET (avslutsproblem, dålig kvalitet på chanserna), inte otur. Tolka inte automatiskt högt xG_real som 'snart vinner de'.",
    "REGEL SWE.1 — Faktisk avslutseffektivitet (mål per skott på mål senaste 5) väger TYNGRE än xG_real när skillnaden är stor.",
    "REGEL SWE.1 — Serieledaren-faktor: lag som ligger i topp tre och spelar BORTA mot mittenlag har historiskt mental edge. Höj awayPct 5-8 enheter när bortalaget är topp-3 oavsett xG.",
    "REGEL SWE.1 — Liten datamängd, var konservativ: max homePct/awayPct = 55% utom vid extrema avbräck. Allsvenskan är jämn — 38/30/32 är ofta rätt baseline.",
  ],
  "eng.1": [
    "PREMIER LEAGUE — TOPPLAG-MOT-MITTENLAG: Båda fel-tipsen var Man City borta med 60-66% där matchen slutade kryss. Topplag som 'borde vinna enkelt' levererar OFTA bara 1-1 mot disciplinerade mittenlag.",
    "REGEL ENG.1 — När awayPct ≥60% på toppfavorit borta mot mittenlag → dra ned 5-8 enheter och flytta till D. Marknaden vet detta, modellen ska också.",
    "REGEL ENG.1 — Bournemouth-typen (disciplinerad mittenlag hemma) tar poäng mot topplag oftare än sannolikheterna säger. Höj drawPct minst 5 enheter när mittenlag möter topp-3-lag hemma.",
    "REGEL ENG.1 — Motivationsasymmetri är SVAGARE i PL än Ligue 1: även 'inget att spela för' Man City spelar oftast nära toppnivå. Övervikta inte motivationsbristen.",
  ],
  "ita.1": [
    "SERIE A — HEMBIAS MOT MITTENLAG: 4/8 fel där hemmamittenlag tippades vinna och förlorade. Hembias är särskilt stark i Serie A-tippandet.",
    "REGEL ITA.1 — Hemmafavoriter mellan mittenlag (40-50% homePct): historiskt går många till kryss eller bortavinst. Sänk homePct 5-7 enheter, höj drawPct till 28-32%.",
    "REGEL ITA.1 — Defensiva strukturer dominerar Serie A. Predicted_score över 2-1 / 1-2 ska motiveras särskilt. Defaulta till lågscoring (1-0, 1-1, 0-1).",
  ],
  "esp.1": [
    "LA LIGA — Bäst presterande liga (3/12 fel). Behåll kalibreringen men:",
    "REGEL ESP.1 — Smala hemmafavoriter (homePct 40-50%) som möter underdogs med stark bortaform → flytta hellre till X. Klassiskt: Osasuna 50% hemma → 1-2 Espanyol.",
    "REGEL ESP.1 — Skadliga avbräck (saknad spjutspets) väger TUNGT i La Liga. Sänk lagets pct minst 8-10 enheter när målskytt-nr-1 är borta.",
  ],
  "bel.1": [
    "BELGISKA PRO LEAGUE — för lite data ännu. Var konservativ: max homePct/awayPct = 55%, drawPct minst 22%.",
    "REGEL BEL.1 — När bortalaget har bättre xG-snitt senaste 5 borta än hemmalagets hemma → bortalaget är favorit oavsett tabellplats.",
  ],
};

export function buildCalibrationHint(cal: LeagueCalibration): string | null {
  const hardRules = LEAGUE_HARD_RULES[cal.leagueId] ?? [];
  const hb = cal.historicalBaseline;
  if (cal.resolved < 1 && cal.topLessons.length === 0 && hardRules.length === 0 && !hb) return null;
  const out: string[] = [];
  out.push(
    `=== LIGASPECIFIK TRÄNING FÖR ${cal.leagueId} (väg detta TUNGT — det är vad just denna liga lärt oss) ===`,
  );
  if (hardRules.length) {
    out.push(`HÅRDA LIGAREGLER (destillerade från historisk feltipp-analys, FÖLJ alltid):`);
    hardRules.forEach((r) => out.push(`  ★ ${r}`));
  }
  if (hb && hb.matches >= 20) {
    out.push(
      `HISTORISK BASELINE (${hb.matches} matcher över ${hb.seasons} säsonger): H ${(hb.homePct * 100).toFixed(0)}% / X ${(hb.drawPct * 100).toFixed(0)}% / 2 ${(hb.awayPct * 100).toFixed(0)}%, BTTS ${(hb.bttsPct * 100).toFixed(0)}%, snitt ${hb.avgGoals.toFixed(2)} mål/match. Använd detta som golv/tak när du sätter sannolikheter — avvik bara med tydlig matchspecifik motivering.`,
    );
  }
  if (cal.resolved >= 1) {
    out.push(
      `Statistik: ${cal.resolved} avgjorda tips av ${cal.total}, träffsäkerhet ${(cal.hitRate * 100).toFixed(0)}%${
        cal.avgBrier != null ? `, Brier ${cal.avgBrier.toFixed(3)} (lägre = bättre, 0.67 = slump)` : ""
      }.`,
    );
  }
  if (cal.resolved >= 5) {
    const ad = cal.actualDistribution;
    out.push(
      `Faktisk utfallsfördelning i ${cal.leagueId}: H ${(ad.H * 100).toFixed(0)}% / D ${(ad.D * 100).toFixed(0)}% / A ${(ad.A * 100).toFixed(0)}%. Anpassa dina sannolikheter mot denna ligaspecifika baseline.`,
    );
    if (cal.btts.n >= 5) {
      out.push(
        `BTTS i ${cal.leagueId}: ${(cal.btts.pct * 100).toFixed(0)}% av matcherna (snitt ${cal.btts.avgGoals?.toFixed(2)} mål). Kalibrera bttsCall och predictedScore mot detta.`,
      );
    }
  }
  const pb = cal.predictedBias;
  if (pb.H > 0.55) out.push(`VARNING: du tippar 1 i ${(pb.H * 100).toFixed(0)}% av matcherna — överskatta INTE hemmalaget.`);
  if (pb.A > 0.45) out.push(`VARNING: du tippar 2 i ${(pb.A * 100).toFixed(0)}% av matcherna — kontrollera att bortafördelen verkligen finns.`);
  if (pb.D < 0.15 && cal.resolved >= 10) {
    out.push(`VARNING: du tippar X bara ${(pb.D * 100).toFixed(0)}% — överväg X aktivt när lagen är jämna.`);
  }
  const high = cal.byConfidence["hög"];
  if (high && high.n >= 4) {
    const rate = high.hits / high.n;
    if (rate < 0.6) out.push(`"Hög" confidence träffar bara ${(rate * 100).toFixed(0)}% (${high.hits}/${high.n}) — höj ribban för hög confidence.`);
  }
  if (cal.topLessons.length) {
    out.push(`LÄRDOMAR FRÅN TIDIGARE MATCHER I ${cal.leagueId} (följ aktivt):`);
    cal.topLessons.forEach((l) => out.push(`  • ${l}`));
  }
  if (cal.topMistakes.length) {
    out.push(`ÅTERKOMMANDE MODELLFEL I ${cal.leagueId} (undvik dessa NU):`);
    cal.topMistakes.forEach((l) => out.push(`  • ${l}`));
  }
  if (cal.topSignalsMissed.length) {
    out.push(`SIGNALER MODELLEN HISTORISKT MISSAT I ${cal.leagueId} (väg in dessa):`);
    cal.topSignalsMissed.forEach((l) => out.push(`  • ${l}`));
  }
  if (cal.recentWrongPicks.length) {
    out.push(`SENASTE FELTIPP I ${cal.leagueId} (lär av dessa konkret):`);
    cal.recentWrongPicks.forEach((w) => {
      const pickLabel = outcomeToTip(w.predicted);
      const actLabel = outcomeToTip(w.actual);
      out.push(
        `  • ${w.home} vs ${w.away}: tippade ${pickLabel} (${w.homePct}/${w.drawPct}/${w.awayPct}), facit ${actLabel}. Lärdom: ${w.lesson}`,
      );
    });
  }
  return out.join("\n");
}

// === Resolve unresolved predictions against ESPN scoreboard ===

async function fetchEventSummary(leagueId: string, eventId: string) {
  try {
    return await espnGet<any>(summaryUrl(leagueId, eventId));
  } catch {
    return null;
  }
}

function extractMatchStats(summary: any): Postmortem["match_stats"] | undefined {
  try {
    const teamStats: any[] = summary?.boxscore?.teams ?? [];
    if (teamStats.length < 2) return undefined;
    const pick = (label: string) => {
      const get = (t: any) =>
        Number(
          t?.statistics?.find((s: any) =>
            (s?.name ?? s?.label ?? "").toLowerCase().includes(label),
          )?.displayValue ?? NaN,
        );
      const h = get(teamStats[0]);
      const a = get(teamStats[1]);
      return Number.isFinite(h) && Number.isFinite(a) ? { home: h, away: a } : undefined;
    };
    const shots = pick("shots") ?? pick("totalshots");
    const shotsOnTarget = pick("shotsongoal") ?? pick("shotsontarget");
    const possession = pick("possession");
    return { shots, shotsOnTarget, possession };
  } catch {
    return undefined;
  }
}

async function generatePostmortemAI(input: {
  home: string;
  away: string;
  homeScore: number;
  awayScore: number;
  predictedOutcome: string;
  predictedScore: string;
  actualOutcome: "H" | "D" | "A";
  homePct: number;
  drawPct: number;
  awayPct: number;
  confidence: string;
  hit1x2: boolean;
  exactScore: boolean;
  stats?: Postmortem["match_stats"];
  keyFactors?: string[] | null;
}): Promise<Postmortem | null> {
  const apiKey = process.env.LOVABLE_API_KEY;
  if (!apiKey) return null;
  const model = "google/gemini-2.5-flash";
  const isWrong = !input.hit1x2;
  const sys = `Du är en fotbollsanalytiker som gör postmortem på tipsmodellens prediktioner.
Förklara KORT, faktabaserat och utan floskler:
- Varför blev resultatet som det blev (form, hemmaplan, taktik, personal, ligaläge)
- Var det rätt av MODELLEN att tippa som den gjorde, givet förhandsinfon? (sannolikheter och confidence)
- Hur stor del var TUR (sent mål, missad straff, rött kort, xG-överprestation, domslut)
- Vilka konkreta LÄRDOMAR ska vi dra till framtida tippningar?
${isWrong ? `
EFTERSOM MODELLEN HADE FEL — gör en DJUPARE analys:
- Lista konkret VAR modellen felbedömde (model_mistakes): t.ex. "övervärderade hemmaplansfördel", "missade att stjärnspelare var skadad", "vägde formkurvan för tungt"
- Lista SIGNALER modellen missade eller undervärderade (signals_missed): t.ex. "bortalagets defensiva struktur senaste 5", "vädret", "rotation inför cupspel", "h2h-trender", "domarprofil"
- Ange vad modellen BORDE tippat istället (alternative_pick) med en mening om varför
- Var självkritisk men datadriven — peka på systematiska fel som går att korrigera, inte bara "otur".
` : ""}
Skriv på svenska. Var direkt. Ingen artighet. Returnera ENDAST tool-call.`;
  const user = `Match: ${input.home} ${input.homeScore}-${input.awayScore} ${input.away}
Modellens tips: ${input.predictedOutcome} (${input.predictedScore}) — confidence ${input.confidence}
Sannolikheter modellen gav: 1=${input.homePct}% X=${input.drawPct}% 2=${input.awayPct}%
Faktiskt utfall: ${input.actualOutcome === "H" ? "1" : input.actualOutcome === "A" ? "2" : "X"}
Resultatet är ${input.hit1x2 ? "RÄTT 1X2" : "FEL 1X2"}${input.exactScore ? " och EXAKT RESULTAT" : ""}.
${input.keyFactors?.length ? `Faktorer modellen vägde in: ${input.keyFactors.join("; ")}` : ""}
${input.stats ? `Matchstatistik: ${JSON.stringify(input.stats)}` : "Matchstatistik saknas."}`;

  const baseProps: Record<string, unknown> = {
    summary: { type: "string" },
    why: {
      type: "array",
      items: { type: "string" },
      minItems: isWrong ? 3 : 2,
      maxItems: isWrong ? 6 : 4,
    },
    luck_level: { type: "string", enum: ["låg", "medel", "hög"] },
    luck_reason: { type: "string" },
    lessons: {
      type: "array",
      items: { type: "string" },
      minItems: 1,
      maxItems: isWrong ? 5 : 3,
    },
  };
  const required = ["summary", "why", "luck_level", "luck_reason", "lessons"];
  if (isWrong) {
    baseProps.model_mistakes = { type: "array", items: { type: "string" }, minItems: 1, maxItems: 4 };
    baseProps.signals_missed = { type: "array", items: { type: "string" }, minItems: 1, maxItems: 4 };
    baseProps.alternative_pick = { type: "string" };
    required.push("model_mistakes", "signals_missed", "alternative_pick");
  }

  try {
    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: sys },
          { role: "user", content: user },
        ],
        tool_choice: { type: "function", function: { name: "submit_postmortem" } },
        tools: [
          {
            type: "function",
            function: {
              name: "submit_postmortem",
              description: "Postmortem av tipset",
              parameters: {
                type: "object",
                properties: baseProps,
                required,
                additionalProperties: false,
              },
            },
          },
        ],
      }),
    });
    if (!res.ok) return null;
    const json: any = await res.json();
    const args = json?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
    if (!args) return null;
    const parsed = JSON.parse(args);
    return {
      verdict: input.hit1x2 ? "right" : "wrong",
      exactScore: input.exactScore,
      summary: String(parsed.summary ?? ""),
      why: Array.isArray(parsed.why) ? parsed.why.map(String) : [],
      luck: {
        level: (parsed.luck_level as Postmortem["luck"]["level"]) ?? "medel",
        reason: String(parsed.luck_reason ?? ""),
      },
      lessons: Array.isArray(parsed.lessons) ? parsed.lessons.map(String) : [],
      model_mistakes: Array.isArray(parsed.model_mistakes) ? parsed.model_mistakes.map(String) : undefined,
      signals_missed: Array.isArray(parsed.signals_missed) ? parsed.signals_missed.map(String) : undefined,
      alternative_pick: parsed.alternative_pick ? String(parsed.alternative_pick) : undefined,
      match_stats: input.stats,
      generated_at: new Date().toISOString(),
      model,
    };
  } catch {
    return null;
  }
}

export async function generatePostmortemForPrediction(predictionId: string) {
  const { data: p } = await supabaseAdmin
    .from("predictions")
    .select(
      "id, league_id, event_id, home_name, away_name, predicted_outcome, predicted_score, home_win_pct, draw_pct, away_win_pct, confidence, key_factors, actual_home_score, actual_away_score, actual_outcome, postmortem, btts_call, btts_reason",
    )
    .eq("id", predictionId)
    .maybeSingle();
  if (!p || !p.actual_outcome) return null;
  const existing = (p.postmortem as any) ?? null;
  // Om vi redan har en fullständig postmortem (inte bara preliminär bttsCall) — returnera den.
  if (existing && !existing.preliminary && existing.verdict) return existing as Postmortem;
  const preservedBtts = extractBtts(p);
  const bttsPreserve =
    preservedBtts.call != null
      ? { bttsCall: preservedBtts.call, bttsReason: preservedBtts.reason ?? "" }
      : {};
  const summary = p.event_id ? await fetchEventSummary(p.league_id, p.event_id) : null;
  const stats = summary ? extractMatchStats(summary) : undefined;
  const hit1x2 = p.predicted_outcome === p.actual_outcome;
  const exactScore =
    !!p.predicted_score &&
    p.predicted_score.replace(/\s/g, "") === `${p.actual_home_score}-${p.actual_away_score}`;
  const pm = await generatePostmortemAI({
    home: p.home_name,
    away: p.away_name,
    homeScore: p.actual_home_score!,
    awayScore: p.actual_away_score!,
    predictedOutcome: p.predicted_outcome,
    predictedScore: p.predicted_score,
    actualOutcome: p.actual_outcome as "H" | "D" | "A",
    homePct: Number(p.home_win_pct),
    drawPct: Number(p.draw_pct),
    awayPct: Number(p.away_win_pct),
    confidence: p.confidence,
    hit1x2,
    exactScore,
    stats,
    keyFactors: (p.key_factors as string[] | null) ?? null,
  });
  if (!pm) return null;
  const merged = { ...bttsPreserve, ...pm };
  await supabaseAdmin.from("predictions").update({ postmortem: merged }).eq("id", predictionId);
  return pm;
}

export async function resolvePendingPredictions(limit = 50) {
  const { data, error } = await supabaseAdmin
    .from("predictions")
    .select("id, league_id, event_id, home_win_pct, draw_pct, away_win_pct")
    .is("resolved_at", null)
    .not("event_id", "is", null)
    .order("created_at", { ascending: true })
    .limit(limit);
  if (error || !data) return { resolved: 0, checked: 0, postmortems: 0 };
  let resolved = 0;
  let postmortems = 0;
  for (const row of data) {
    const score = await fetchEventScore(row.league_id, row.event_id!);
    if (!score) continue;
    const actual: "H" | "D" | "A" =
      score.homeScore > score.awayScore ? "H" : score.homeScore < score.awayScore ? "A" : "D";
    const b = brierScore(
      Number(row.home_win_pct),
      Number(row.draw_pct),
      Number(row.away_win_pct),
      actual,
    );
    await supabaseAdmin
      .from("predictions")
      .update({
        actual_home_score: score.homeScore,
        actual_away_score: score.awayScore,
        actual_outcome: actual,
        brier_score: b,
        resolved_at: new Date().toISOString(),
      })
      .eq("id", row.id);
    resolved++;
    // Generera postmortem i bakgrunden (men awaitad för att garantera spar)
    const pm = await generatePostmortemForPrediction(row.id);
    if (pm) postmortems++;
  }

  // Backfill: generera postmortem för redan resolvade som saknar fullständig postmortem
  // (postmortem kan vara null ELLER bara preliminär btts-stamp utan verdict).
  const { data: missing } = await supabaseAdmin
    .from("predictions")
    .select("id, postmortem")
    .not("actual_outcome", "is", null)
    .order("resolved_at", { ascending: false })
    .limit(40);
  for (const m of missing ?? []) {
    const pm = (m as any).postmortem;
    if (pm && !pm.preliminary && pm.verdict) continue;
    const generated = await generatePostmortemForPrediction(m.id);
    if (generated) postmortems++;
  }

  return { resolved, checked: data.length, postmortems };
}

async function fetchEventScore(leagueId: string, eventId: string) {
  try {
    const data: any = await espnGet(summaryUrl(leagueId, eventId));
    const comp = data?.header?.competitions?.[0];
    if (!comp?.status?.type?.completed) return null;
    const competitors: any[] = comp?.competitors ?? [];
    const home = competitors.find((c) => c.homeAway === "home");
    const away = competitors.find((c) => c.homeAway === "away");
    if (!home || !away) return null;
    const hs = Number(home.score);
    const as = Number(away.score);
    if (Number.isNaN(hs) || Number.isNaN(as)) return null;
    return { homeScore: hs, awayScore: as };
  } catch {
    return null;
  }
}
