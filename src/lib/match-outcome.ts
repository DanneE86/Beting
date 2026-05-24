import type { Outcome } from "./poisson-model";

export type TipLabel = "1" | "X" | "2";

/** H/D/A → 1/X/2 */
export function outcomeToTip(outcome: Outcome | string | null | undefined): TipLabel {
  if (outcome === "H") return "1";
  if (outcome === "A") return "2";
  return "X";
}

/** 1/X/2 → H/D/A (t.ex. från arkivdata) */
export function tipToOutcome(tip: string | null | undefined): Outcome | null {
  if (tip === "1") return "H";
  if (tip === "2") return "A";
  if (tip === "X") return "D";
  return null;
}

/** Mål → 1/X/2 (arkiv/backfill) */
export function outcomeFromScore(h: number | null, a: number | null): TipLabel | null {
  if (h == null || a == null) return null;
  if (h > a) return "1";
  if (h < a) return "2";
  return "X";
}

/** Brier score för 1X2-prognos. */
export function brierScore(
  homePct: number,
  drawPct: number,
  awayPct: number,
  actual: Outcome,
): number {
  const p = { H: homePct / 100, D: drawPct / 100, A: awayPct / 100 };
  const o = { H: actual === "H" ? 1 : 0, D: actual === "D" ? 1 : 0, A: actual === "A" ? 1 : 0 };
  return (p.H - o.H) ** 2 + (p.D - o.D) ** 2 + (p.A - o.A) ** 2;
}

/** Exakt resultat matchar facit? */
export function isExactScore(
  predicted: string | null | undefined,
  homeScore: number | null | undefined,
  awayScore: number | null | undefined,
): boolean {
  if (predicted == null || homeScore == null || awayScore == null) return false;
  return predicted.replace(/\s/g, "") === `${homeScore}-${awayScore}`;
}
