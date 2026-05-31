/**
 * Heuristiker inspirerade av professionella spelare / sharp-bettors arbetssätt:
 * - Sätt egen sannolikhet FÖRST, använd marknaden som kontroll (CLV-tänk)
 * - Spela bara när edge ≥ tröskel (positiv förväntad value)
 * - Undvik överkonfidens på bortafavoriter och smala hemmafavoriter
 * - Motivation, vila och jämna matcher → mer X
 */

import { outcomeToTip } from "./match-outcome";
import {
  normalizeProbs,
  pickOutcome,
  type MatchProbs,
} from "./poisson-model";

export type ProBettorContext = {
  homeRestDays?: number | null;
  awayRestDays?: number | null;
  ptsDiff?: number;
  gdDiff?: number;
  motivationAsymmetry?: boolean;
  motivatedSide?: "home" | "away" | null;
  homeStakeLabel?: string;
  awayStakeLabel?: string;
  homeAbsenceScore?: number;
  awayAbsenceScore?: number;
  marketProbPct?: { home: number; draw: number; away: number };
  decimalOdds?: { home: number | null; draw: number | null; away: number | null };
};

/**
 * Kelly Criterion (25% fractional Kelly för konservativ bankrullshantering).
 * Returnerar rekommenderad insats i % av bankroll. 0 = inget spelvärde.
 */
export function kellyFraction(modelPct: number, decimalOdds: number): number {
  if (decimalOdds <= 1 || modelPct <= 0 || modelPct >= 100) return 0;
  const p = modelPct / 100;
  const b = decimalOdds - 1; // netto-vinst per enhet
  const fullKelly = (p * b - (1 - p)) / b;
  // 25% Kelly — välbevisat balans mellan tillväxt och drawdown-risk
  return Math.max(0, Math.round(fullKelly * 25 * 10) / 10);
}

const MIN_EDGE_TO_BET = 5;
const MIN_EDGE_FOR_HIGH_CONF = 8;

export function applyProBettorAdjustments(
  probs: MatchProbs,
  ctx: ProBettorContext,
): { probs: MatchProbs; notes: string[] } {
  let { homeWinPct, drawPct, awayWinPct } = probs;
  const notes: string[] = [];

  // Jämna lag → proffs ökar kryss (typiskt 28–34%)
  if (ctx.ptsDiff != null && Math.abs(ctx.ptsDiff) < 6) {
    drawPct = Math.min(36, drawPct + 4);
    homeWinPct = Math.max(5, homeWinPct - 2);
    awayWinPct = Math.max(5, awayWinPct - 2);
    notes.push("Jämna lag i tabellen — proffs höjer X-vikt.");
  }

  // Bortafavorit >55% — historiskt överskattat
  if (awayWinPct >= 55 && awayWinPct >= homeWinPct && awayWinPct >= drawPct) {
    awayWinPct -= 5;
    drawPct += 3;
    notes.push("Bortafavorit — proffs drar ned 2-sannolikhet (svårare att leverera borta).");
  }

  // Smal hemmafavorit 45–52%
  if (homeWinPct >= 45 && homeWinPct <= 52 && homeWinPct >= awayWinPct) {
    drawPct = Math.min(34, drawPct + 3);
    homeWinPct -= 2;
    notes.push("Smal hemmafavorit — proffs föredrar ofta X/2 framför tunn 1.");
  }

  // Motivation (CL säkrad vs Europa-kamp m.m.)
  const stakeDetail =
    ctx.homeStakeLabel && ctx.awayStakeLabel
      ? ` (${ctx.homeStakeLabel} vs ${ctx.awayStakeLabel})`
      : "";
  if (ctx.motivationAsymmetry && ctx.motivatedSide === "home") {
    homeWinPct += 5;
    awayWinPct = Math.max(5, awayWinPct - 3);
    notes.push(`Motivation: hemmalag har mer att spela för${stakeDetail}.`);
  } else if (ctx.motivationAsymmetry && ctx.motivatedSide === "away") {
    awayWinPct += 5;
    homeWinPct = Math.max(5, homeWinPct - 3);
    notes.push(`Motivation: bortalag har mer att spela för${stakeDetail}.`);
  }

  // Matchtrötthet (<4 dagar)
  if (ctx.homeRestDays != null && ctx.homeRestDays < 4) {
    homeWinPct = Math.max(5, homeWinPct - 3);
    notes.push(`Hemmalag kort vila (${ctx.homeRestDays} d) — proffs sänker 1.`);
  }
  if (ctx.awayRestDays != null && ctx.awayRestDays < 4) {
    awayWinPct = Math.max(5, awayWinPct - 3);
    notes.push(`Bortalag kort vila (${ctx.awayRestDays} d) — proffs sänker 2.`);
  }

  // Nyckelavbräck asymmetri
  const absDiff = (ctx.homeAbsenceScore ?? 0) - (ctx.awayAbsenceScore ?? 0);
  if (absDiff >= 2) {
    homeWinPct = Math.max(5, homeWinPct - 4);
    drawPct += 2;
    awayWinPct += 2;
    notes.push("Hemmalaget tappar fler nyckelspelare — skift mot X/2.");
  } else if (absDiff <= -2) {
    awayWinPct = Math.max(5, awayWinPct - 4);
    drawPct += 2;
    homeWinPct += 2;
    notes.push("Bortalaget tappar fler nyckelspelare — skift mot 1/X.");
  }

  return {
    probs: normalizeProbs(homeWinPct, drawPct, awayWinPct),
    notes,
  };
}

export function buildProBettingAdvice(
  probs: MatchProbs,
  ctx: ProBettorContext,
  confidence: "låg" | "medel" | "hög",
): { bettingTip: string; valueBet: string; confidence: "låg" | "medel" | "hög" } {
  const outcome = pickOutcome(probs.homeWinPct, probs.drawPct, probs.awayWinPct);
  const tipLabel = outcomeToTip(outcome);
  const model = { H: probs.homeWinPct, D: probs.drawPct, A: probs.awayWinPct }[outcome];
  const top = Math.max(probs.homeWinPct, probs.drawPct, probs.awayWinPct);

  let valueBet = "Odds saknas — ingen marknadsjämförelse.";
  let edge = 0;
  let kellySuggestion = "";
  if (ctx.marketProbPct) {
    const mkt = { H: ctx.marketProbPct.home, D: ctx.marketProbPct.draw, A: ctx.marketProbPct.away }[outcome];
    edge = Math.round((model - mkt) * 10) / 10;

    const decOdds = ctx.decimalOdds
      ? { H: ctx.decimalOdds.home, D: ctx.decimalOdds.draw, A: ctx.decimalOdds.away }[outcome]
      : null;
    const kelly = decOdds ? kellyFraction(model, decOdds) : 0;
    if (kelly > 0) kellySuggestion = ` Kelly: ${kelly}% av bankroll.`;

    if (edge >= MIN_EDGE_TO_BET) {
      valueBet = `Proffs-edge på ${tipLabel}: modell ${model}% vs marknad ${mkt}% (+${edge}%).${kellySuggestion}`;
    } else if (edge <= -MIN_EDGE_TO_BET) {
      valueBet = `Marknaden ${mkt}% vs modell ${model}% — undvik ${tipLabel} (negativ edge).`;
    } else {
      valueBet = `Ingen tydlig edge (${edge >= 0 ? "+" : ""}${edge}%) — proffs skippar oftast.`;
    }
  }

  let conf = confidence;
  if (edge >= MIN_EDGE_FOR_HIGH_CONF && top >= 52) conf = "hög";
  else if (edge < MIN_EDGE_TO_BET || top < 45) conf = "låg";

  const action =
    edge >= MIN_EDGE_TO_BET
      ? `Spelvärd ${tipLabel} (${top}%, edge +${edge}%${kellySuggestion ? `, ${kellySuggestion.trim()}` : ""})`
      : edge <= -MIN_EDGE_TO_BET
        ? `Ingen action — marknaden prissatt bättre`
        : `Lean ${tipLabel} (${top}%) — liten/ingen edge, låg insats`;

  return {
    bettingTip: `Proffsanalys: ${action}. Dixon-Coles + 3 års ligahistorik.`,
    valueBet,
    confidence: conf,
  };
}
