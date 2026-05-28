import type { ArchivedMatchRow } from "./league-training";
import { tipToOutcome } from "./match-outcome";
import { pickOutcome, poissonMatchPrediction } from "./poisson-model";

export type MatchOutcomeAnalysis = {
  summary: string;
  why: string[];
  lessons: string[];
  signals: string[];
  tags: string[];
  baselinePick: "H" | "D" | "A";
  baselineProbs: { home: number; draw: number; away: number };
  actualOutcome: "H" | "D" | "A";
  baselineCorrect: boolean;
  totalGoals: number;
  lowScoring: boolean;
  highScoring: boolean;
  homeForm: TeamFormSnapshot | null;
  awayForm: TeamFormSnapshot | null;
};

export type TeamFormSnapshot = {
  played: number;
  points: number;
  gf: number;
  ga: number;
  wins: number;
  draws: number;
  losses: number;
};

type HistoryRow = ArchivedMatchRow & {
  home_name?: string;
  away_name?: string;
};

function teamFormBefore(history: HistoryRow[], teamId: string, before: Date, n = 8): TeamFormSnapshot | null {
  const games = history
    .filter(
      (m) =>
        new Date(m.event_date) < before &&
        (m.home_id === teamId || m.away_id === teamId),
    )
    .slice(-n);
  if (games.length < 3) return null;
  let points = 0;
  let gf = 0;
  let ga = 0;
  let wins = 0;
  let draws = 0;
  let losses = 0;
  for (const m of games) {
    const home = m.home_id === teamId;
    const scored = home ? m.home_score : m.away_score;
    const conceded = home ? m.away_score : m.home_score;
    gf += scored;
    ga += conceded;
    if (scored > conceded) {
      wins++;
      points += 3;
    } else if (scored === conceded) {
      draws++;
      points += 1;
    } else losses++;
  }
  return { played: games.length, points, gf, ga, wins, draws, losses };
}

function attackDefense(form: TeamFormSnapshot) {
  const n = form.played;
  return { attack: form.gf / n, defense: form.ga / n };
}

/** Förklarar varför matchen slutade som den gjorde utifrån form, målbild och baseline-modell. */
export function analyzeMatchOutcome(
  match: HistoryRow,
  history: HistoryRow[],
  leagueAvgGoals = 2.55,
  homeAdvantage = 1.15,
): MatchOutcomeAnalysis {
  const before = new Date(match.event_date);
  const homeForm = teamFormBefore(history, match.home_id, before);
  const awayForm = teamFormBefore(history, match.away_id, before);
  const actual = tipToOutcome(match.outcome) ?? "D";
  const totalGoals = match.home_score + match.away_score;
  const lowScoring = totalGoals <= 2;
  const highScoring = totalGoals >= 4;

  let homeWinPct = 33;
  let drawPct = 28;
  let awayWinPct = 39;

  if (homeForm && awayForm) {
    const ha = attackDefense(homeForm);
    const aa = attackDefense(awayForm);
    const { probs } = poissonMatchPrediction({
      homeAttack: ha.attack,
      homeDefense: ha.defense,
      awayAttack: aa.attack,
      awayDefense: aa.defense,
      leagueAvgGoals,
      homeAdvantage,
    });
    homeWinPct = probs.homeWinPct;
    drawPct = probs.drawPct;
    awayWinPct = probs.awayWinPct;
  }

  const baselinePick = pickOutcome(homeWinPct, drawPct, awayWinPct);
  const baselineCorrect = baselinePick === actual;

  const why: string[] = [];
  const lessons: string[] = [];
  const signals: string[] = [];
  const tags: string[] = [];

  if (homeForm) {
    signals.push(
      `Hemmaform (${homeForm.played}): ${homeForm.wins}V-${homeForm.draws}O-${homeForm.losses}F, ${homeForm.gf}-${homeForm.ga} mål`,
    );
  }
  if (awayForm) {
    signals.push(
      `Bortaform (${awayForm.played}): ${awayForm.wins}V-${awayForm.draws}O-${awayForm.losses}F, ${awayForm.gf}-${awayForm.ga} mål`,
    );
  }

  if (match.home_score > match.away_score) {
    why.push("Hemmalaget vann målskillnaden — ofta kopplat till hemmaplansfördel eller bättre offensiv dag.");
    if (homeForm && homeForm.wins >= homeForm.losses) {
      why.push("Hemmalaget kom in med positiv form vilket stärker förklaringen.");
      tags.push("home-form-strong");
    }
    if (awayForm && awayForm.losses > awayForm.wins) {
      why.push("Bortalaget hade svagare form inför matchen.");
      tags.push("away-form-weak");
    }
  } else if (match.away_score > match.home_score) {
    why.push("Bortalaget tog tre poäng — tyder på överlägsen prestation eller hemma som underpresterade.");
    if (awayForm && awayForm.wins >= 2) tags.push("away-form-strong");
    if (homeForm && homeForm.losses >= homeForm.wins) tags.push("home-form-weak");
  } else {
    why.push("Oavgjort — jämn match där inget lag kunde avgöra.");
    tags.push("draw");
    if (homeForm && awayForm) {
      const ptsH = homeForm.points / homeForm.played;
      const ptsA = awayForm.points / awayForm.played;
      if (Math.abs(ptsH - ptsA) < 0.4) {
        why.push("Lagen hade liknande poängsnitt inför matchen — kryss var sannolikt.");
        tags.push("even-teams");
      }
    }
  }

  if (lowScoring) {
    why.push(`Lågt målantal (${totalGoals}) — defensiv dominans eller svag avslutning.`);
    tags.push("low-scoring");
    lessons.push("Vid två defensivt stabila lag: sänk målförväntan och höj X-vikt.");
  }
  if (highScoring) {
    why.push(`Högt målantal (${totalGoals}) — öppet spel eller svaga defensiver.`);
    tags.push("high-scoring");
    lessons.push("När båda lag släpper in mål i formkurvan: öka BTTS och över-tendens.");
  }
  if (match.btts) {
    tags.push("btts-yes");
    why.push("Båda lagen gjorde mål — offensiv bredd eller svag defensiv struktur.");
  } else {
    tags.push("btts-no");
    why.push("Minst ett lag höll nollan — defensiv disciplin eller svag anfallslinje.");
  }

  if (!baselineCorrect) {
    lessons.push(
      `Baseline (${baselinePick}) missade facit ${actual} — granska om formvikter eller hemmafördel var felkalibrerad.`,
    );
    tags.push("baseline-miss");
  } else {
    tags.push("baseline-hit");
  }

  const summary =
    `${match.home_name ?? "Hemma"} ${match.home_score}-${match.away_score} ${match.away_name ?? "Borta"}: ` +
    why[0];

  return {
    summary,
    why,
    lessons,
    signals,
    tags,
    baselinePick,
    baselineProbs: { home: homeWinPct, draw: drawPct, away: awayWinPct },
    actualOutcome: actual,
    baselineCorrect,
    totalGoals,
    lowScoring,
    highScoring,
    homeForm,
    awayForm,
  };
}
