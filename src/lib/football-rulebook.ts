import type { MatchOutcomeAnalysis } from "./football-match-analyzer";
import type { ArchivedMatchRow } from "./league-training";
import { brierScore, tipToOutcome } from "./match-outcome";
import {
  normalizeProbs,
  pickOutcome,
  poissonMatchPrediction,
  type MatchProbs,
} from "./poisson-model";

export type FootballRule = {
  id: string;
  description: string;
  triggerTag?: string;
  when?: {
    minHomePct?: number;
    maxHomePct?: number;
    minDrawPct?: number;
    minAwayPct?: number;
    maxAwayPct?: number;
    ptsDiffMax?: number;
  };
  adjust: { home?: number; draw?: number; away?: number };
  weight: number;
  source: "mined" | "manual" | "optimized";
};

export type RulebookBacktest = {
  matches: number;
  baselineHits: number;
  rulebookHits: number;
  baselineHitRate: number;
  rulebookHitRate: number;
  baselineBrier: number;
  rulebookBrier: number;
  improved: number;
};

export type RuleContext = {
  tags: string[];
  homePtsPerGame?: number;
  awayPtsPerGame?: number;
};

type TeamRun = {
  attack: number;
  defense: number;
  ppg: number;
  n: number;
};

const CANDIDATE_RULES: FootballRule[] = [
  {
    id: "draw-even-teams",
    description: "Jämna lag i form → höj X",
    triggerTag: "even-teams",
    adjust: { draw: 3, home: -1.5, away: -1.5 },
    weight: 1,
    source: "manual",
  },
  {
    id: "boost-away-form",
    description: "Bortalag i stark form → höj 2",
    triggerTag: "away-form-strong",
    adjust: { away: 4, home: -2, draw: -1 },
    weight: 1,
    source: "manual",
  },
  {
    id: "penalize-weak-home",
    description: "Svag hemmaform → sänk 1",
    triggerTag: "home-form-weak",
    adjust: { home: -3, draw: 2 },
    weight: 1,
    source: "manual",
  },
  {
    id: "low-scoring-draw",
    description: "Låg förväntad målbild → höj X",
    triggerTag: "low-scoring",
    adjust: { draw: 2.5, home: -1, away: -1.5 },
    weight: 1,
    source: "manual",
  },
  {
    id: "narrow-home-favorite",
    description: "Smal hemmafavorit 44–52% → höj X",
    when: { minHomePct: 44, maxHomePct: 52 },
    adjust: { draw: 2.5, home: -2 },
    weight: 1,
    source: "manual",
  },
  {
    id: "away-favorite-inflation",
    description: "Bortafavorit ≥54% → dra ned 2",
    when: { minAwayPct: 54 },
    adjust: { away: -4, draw: 2.5, home: 1.5 },
    weight: 1,
    source: "manual",
  },
  {
    id: "close-table-draw",
    description: "Tabellskillnad ≤0.45 ppg → höj X",
    when: { ptsDiffMax: 0.45 },
    adjust: { draw: 3, home: -1.5, away: -1.5 },
    weight: 1,
    source: "manual",
  },
  {
    id: "strong-home-edge",
    description: "Tydlig hemmafavorit ≥58% → förstärk 1",
    when: { minHomePct: 58 },
    adjust: { home: 2, draw: -1, away: -1 },
    weight: 1,
    source: "manual",
  },
];

/** Bygger regelbok från batch-analyser (kandidater för optimering). */
export function buildRulebookFromAnalyses(
  analyses: Array<{ analysis: MatchOutcomeAnalysis; leagueId: string }>,
): FootballRule[] {
  const tagMiss = new Map<string, number>();
  for (const { analysis } of analyses) {
    if (analysis.baselineCorrect) continue;
    for (const tag of analysis.tags) {
      tagMiss.set(tag, (tagMiss.get(tag) ?? 0) + 1);
    }
  }

  const mined: FootballRule[] = [];
  if ((tagMiss.get("even-teams") ?? 0) >= 8) mined.push({ ...CANDIDATE_RULES[0], source: "mined" });
  if ((tagMiss.get("away-form-strong") ?? 0) >= 6) mined.push({ ...CANDIDATE_RULES[1], source: "mined" });
  if ((tagMiss.get("home-form-weak") ?? 0) >= 6) mined.push({ ...CANDIDATE_RULES[2], source: "mined" });
  if ((tagMiss.get("low-scoring") ?? 0) >= 10) mined.push({ ...CANDIDATE_RULES[3], source: "mined" });
  return mined;
}

export function applyFootballRules(
  probs: MatchProbs,
  rules: FootballRule[],
  ctx: RuleContext,
): { probs: MatchProbs; applied: string[] } {
  let { homeWinPct, drawPct, awayWinPct } = probs;
  const applied: string[] = [];

  for (const rule of rules) {
    if (rule.triggerTag && !ctx.tags.includes(rule.triggerTag)) continue;
    if (rule.when?.minHomePct != null && homeWinPct < rule.when.minHomePct) continue;
    if (rule.when?.maxHomePct != null && homeWinPct > rule.when.maxHomePct) continue;
    if (rule.when?.minDrawPct != null && drawPct < rule.when.minDrawPct) continue;
    if (rule.when?.minAwayPct != null && awayWinPct < rule.when.minAwayPct) continue;
    if (rule.when?.maxAwayPct != null && awayWinPct > rule.when.maxAwayPct) continue;
    if (rule.when?.ptsDiffMax != null && ctx.homePtsPerGame != null && ctx.awayPtsPerGame != null) {
      if (Math.abs(ctx.homePtsPerGame - ctx.awayPtsPerGame) > rule.when.ptsDiffMax) continue;
    }
    if (
      rule.id === "narrow-home-favorite" &&
      !(homeWinPct >= awayWinPct && homeWinPct >= drawPct)
    ) {
      continue;
    }
    if (
      rule.id === "away-favorite-inflation" &&
      !(awayWinPct >= homeWinPct && awayWinPct >= drawPct)
    ) {
      continue;
    }

    const w = rule.weight;
    homeWinPct += (rule.adjust.home ?? 0) * w;
    drawPct += (rule.adjust.draw ?? 0) * w;
    awayWinPct += (rule.adjust.away ?? 0) * w;
    applied.push(rule.id);
  }

  return { probs: normalizeProbs(homeWinPct, drawPct, awayWinPct), applied };
}

function teamRun(history: ArchivedMatchRow[], teamId: string, before: Date): TeamRun | null {
  const games = history.filter(
    (m) =>
      new Date(m.event_date) < before &&
      (m.home_id === teamId || m.away_id === teamId),
  );
  const last = games.slice(-30);
  if (last.length < 5) return null;
  let gf = 0;
  let ga = 0;
  let pts = 0;
  for (const m of last) {
    const home = m.home_id === teamId;
    const scored = home ? m.home_score : m.away_score;
    const conceded = home ? m.away_score : m.home_score;
    gf += scored;
    ga += conceded;
    if (scored > conceded) pts += 3;
    else if (scored === conceded) pts += 1;
  }
  const n = last.length;
  return { attack: gf / n, defense: ga / n, ppg: pts / n, n };
}

export function buildRuleContext(
  hs: TeamRun,
  as: TeamRun,
  probs: MatchProbs,
  leagueAvgGoals: number,
): RuleContext {
  const tags: string[] = [];
  if (Math.abs(hs.ppg - as.ppg) < 0.45) tags.push("even-teams");
  if (as.attack >= hs.attack * 0.95 && as.ppg >= hs.ppg + 0.25) tags.push("away-form-strong");
  if (hs.ppg + 0.35 < as.ppg) tags.push("home-form-weak");
  const xgProxy = hs.attack + as.attack;
  if (xgProxy < leagueAvgGoals * 0.92 || leagueAvgGoals < 2.45) tags.push("low-scoring");
  if (probs.drawPct >= 30 && Math.abs(probs.homeWinPct - probs.awayWinPct) < 8) tags.push("draw");
  return { tags, homePtsPerGame: hs.ppg, awayPtsPerGame: as.ppg };
}

/** Walk-forward backtest med taggar och tabellkontext. */
export function backtestRulebook(
  rows: ArchivedMatchRow[],
  rules: FootballRule[],
  leagueAvgGoals = 2.55,
  homeAdvantage = 1.15,
  testFraction = 0.3,
): RulebookBacktest {
  const sorted = [...rows].sort(
    (a, b) => new Date(a.event_date).getTime() - new Date(b.event_date).getTime(),
  );
  const testStart = Math.floor(sorted.length * (1 - testFraction));
  const testSlice = sorted.slice(testStart);

  let baselineHits = 0;
  let rulebookHits = 0;
  let baselineBrierSum = 0;
  let rulebookBrierSum = 0;
  let improved = 0;
  let tested = 0;

  for (const m of testSlice) {
    const before = new Date(m.event_date);
    const hs = teamRun(sorted, m.home_id, before);
    const as = teamRun(sorted, m.away_id, before);
    if (!hs || !as) continue;

    const { probs } = poissonMatchPrediction({
      homeAttack: hs.attack,
      homeDefense: hs.defense,
      awayAttack: as.attack,
      awayDefense: as.defense,
      leagueAvgGoals,
      homeAdvantage,
    });

    const actual = tipToOutcome(m.outcome);
    if (!actual) continue;

    const ctx = buildRuleContext(hs, as, probs, leagueAvgGoals);
    const basePick = pickOutcome(probs.homeWinPct, probs.drawPct, probs.awayWinPct);
    const { probs: adjusted } = applyFootballRules(probs, rules, ctx);
    const rulePick = pickOutcome(
      adjusted.homeWinPct,
      adjusted.drawPct,
      adjusted.awayWinPct,
    );

    if (basePick === actual) baselineHits++;
    if (rulePick === actual) rulebookHits++;
    baselineBrierSum += brierScore(probs.homeWinPct, probs.drawPct, probs.awayWinPct, actual);
    rulebookBrierSum += brierScore(
      adjusted.homeWinPct,
      adjusted.drawPct,
      adjusted.awayWinPct,
      actual,
    );
    if (rulePick === actual && basePick !== actual) improved++;
    tested++;
  }

  return {
    matches: tested,
    baselineHits,
    rulebookHits,
    baselineHitRate: tested ? baselineHits / tested : 0,
    rulebookHitRate: tested ? rulebookHits / tested : 0,
    baselineBrier: tested ? baselineBrierSum / tested : 0,
    rulebookBrier: tested ? rulebookBrierSum / tested : 0,
    improved,
  };
}

/** Väljer greedigt regler som slår baseline på walk-forward-test. */
export function optimizeRulebook(
  rows: ArchivedMatchRow[],
  seedRules: FootballRule[] = [],
  leagueAvgGoals?: number,
): { rules: FootballRule[]; backtest: RulebookBacktest } {
  const avgGoals =
    leagueAvgGoals ??
    (rows.length
      ? rows.reduce((s, r) => s + r.home_score + r.away_score, 0) / rows.length
      : 2.55);

  const baseline = backtestRulebook(rows, [], avgGoals);
  const pool = [...CANDIDATE_RULES];
  for (const r of seedRules) {
    if (!pool.some((p) => p.id === r.id)) pool.push(r);
  }

  let selected: FootballRule[] = [];
  let best = baseline;

  let progress = true;
  while (progress) {
    progress = false;
    for (const rule of pool) {
      if (selected.some((s) => s.id === rule.id)) continue;
      const trial = [...selected, rule];
      const bt = backtestRulebook(rows, trial, avgGoals);
      const hitGain = bt.rulebookHitRate - best.rulebookHitRate;
      const brierOk = bt.rulebookBrier <= best.rulebookBrier + 0.003;
      if (hitGain > 0.002 || (hitGain >= 0 && brierOk && bt.rulebookHitRate > baseline.baselineHitRate)) {
        if (bt.rulebookHitRate >= best.rulebookHitRate && brierOk) {
          selected = trial;
          best = bt;
          progress = true;
          break;
        }
      }
    }
  }

  if (best.rulebookHitRate <= baseline.baselineHitRate) {
    return { rules: [], backtest: baseline };
  }

  return { rules: selected, backtest: best };
}

/** @deprecated Använd optimizeRulebook */
export function refineRulebook(
  rules: FootballRule[],
  rows: ArchivedMatchRow[],
  leagueAvgGoals?: number,
) {
  return optimizeRulebook(rows, rules, leagueAvgGoals);
}
