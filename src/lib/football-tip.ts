import type { BttsCall } from "./prediction-meta";
import type { Outcome } from "./poisson-model";
import { outcomeToTip } from "./match-outcome";

/** En rad: vad du ska tippa (1 / X / 2). */
export function formatFootballBettingTip(
  outcome: Outcome,
  topPct?: number,
): string {
  const tip = outcomeToTip(outcome);
  if (topPct != null && Number.isFinite(topPct)) {
    return `Tippa ${tip} (${Math.round(topPct)}%)`;
  }
  return `Tippa ${tip}`;
}

export function formatFootballBttsLine(call: BttsCall | null | undefined): string {
  if (call === "ja") return "Ja";
  if (call === "nej") return "Nej";
  if (call === "osäker") return "Osäker";
  return "—";
}

export function pickTopPct(
  outcome: Outcome,
  homeWinPct: number,
  drawPct: number,
  awayWinPct: number,
): number {
  if (outcome === "H") return homeWinPct;
  if (outcome === "A") return awayWinPct;
  return drawPct;
}
