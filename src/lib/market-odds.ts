import { espnGet, summaryUrl } from "./espn.api";

export type MarketOddsSnapshot = {
  providers: number;
  decimalOdds: { home: number | null; draw: number | null; away: number | null };
  marketProbPct: { home: number; draw: number; away: number };
};

export type MarketLineMovement = {
  open: MarketOddsSnapshot;
  current: MarketOddsSnapshot;
  homeProbDelta: number;
  drawProbDelta: number;
  awayProbDelta: number;
  homeDecimalDelta: number | null;
  drawDecimalDelta: number | null;
  awayDecimalDelta: number | null;
  strongestSide: "1" | "X" | "2" | null;
  strongestDeltaPct: number;
  significant: boolean;
  summary: string;
};

function round1(n: number) {
  return Math.round(n * 10) / 10;
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

function numberOrNull(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function sideDirection(deltaPct: number) {
  if (deltaPct >= 1.5) return "kortats";
  if (deltaPct <= -1.5) return "driftat";
  return "oförändrat";
}

function pctPart(label: "1" | "X" | "2", delta: number) {
  const dir = sideDirection(delta);
  if (dir === "oförändrat") return `${label} oförändrat`;
  return `${label} ${dir} (${delta > 0 ? "+" : ""}${round1(delta)}p)`;
}

export function coerceMarketOddsSnapshot(raw: unknown): MarketOddsSnapshot | null {
  if (!raw || typeof raw !== "object") return null;
  const data = raw as Record<string, any>;
  const homePct = numberOrNull(data.marketProbPct?.home);
  const drawPct = numberOrNull(data.marketProbPct?.draw);
  const awayPct = numberOrNull(data.marketProbPct?.away);
  if (homePct == null || drawPct == null || awayPct == null) return null;
  return {
    providers: Number(data.providers ?? 0) || 0,
    decimalOdds: {
      home: numberOrNull(data.decimalOdds?.home),
      draw: numberOrNull(data.decimalOdds?.draw),
      away: numberOrNull(data.decimalOdds?.away),
    },
    marketProbPct: {
      home: round1(homePct),
      draw: round1(drawPct),
      away: round1(awayPct),
    },
  };
}

export function buildMarketLineMovement(
  open: MarketOddsSnapshot | null | undefined,
  current: MarketOddsSnapshot | null | undefined,
): MarketLineMovement | null {
  if (!open || !current) return null;
  const homeProbDelta = round1(current.marketProbPct.home - open.marketProbPct.home);
  const drawProbDelta = round1(current.marketProbPct.draw - open.marketProbPct.draw);
  const awayProbDelta = round1(current.marketProbPct.away - open.marketProbPct.away);
  const deltas: Array<{ side: "1" | "X" | "2"; delta: number }> = [
    { side: "1", delta: Math.abs(homeProbDelta) },
    { side: "X", delta: Math.abs(drawProbDelta) },
    { side: "2", delta: Math.abs(awayProbDelta) },
  ].sort((a, b) => b.delta - a.delta);

  const strongest = deltas[0] ?? { side: null, delta: 0 };
  const summary = `Linjerörelse: ${pctPart("1", homeProbDelta)} · ${pctPart("X", drawProbDelta)} · ${pctPart("2", awayProbDelta)}.`;

  return {
    open,
    current,
    homeProbDelta,
    drawProbDelta,
    awayProbDelta,
    homeDecimalDelta:
      open.decimalOdds.home != null && current.decimalOdds.home != null
        ? round2(current.decimalOdds.home - open.decimalOdds.home)
        : null,
    drawDecimalDelta:
      open.decimalOdds.draw != null && current.decimalOdds.draw != null
        ? round2(current.decimalOdds.draw - open.decimalOdds.draw)
        : null,
    awayDecimalDelta:
      open.decimalOdds.away != null && current.decimalOdds.away != null
        ? round2(current.decimalOdds.away - open.decimalOdds.away)
        : null,
    strongestSide: strongest.side,
    strongestDeltaPct: round1(strongest.delta),
    significant: strongest.delta >= 2,
    summary,
  };
}

export async function getMarketOdds(leagueSlug: string, eventId: string): Promise<MarketOddsSnapshot | null> {
  try {
    const summary: any = await espnGet(summaryUrl(leagueSlug, eventId));
    const pc: any[] = summary?.pickcenter ?? [];
    if (!pc.length) return null;
    const homeOdds = pc
      .map((p) => Number(p?.homeTeamOdds?.moneyLine))
      .filter((n) => Number.isFinite(n) && n !== 0);
    const drawOdds = pc
      .map((p) => Number(p?.drawOdds?.moneyLine))
      .filter((n) => Number.isFinite(n) && n !== 0);
    const awayOdds = pc
      .map((p) => Number(p?.awayTeamOdds?.moneyLine))
      .filter((n) => Number.isFinite(n) && n !== 0);
    const toDec = (ml: number) => (ml > 0 ? ml / 100 + 1 : 100 / Math.abs(ml) + 1);
    const avg = (arr: number[]) =>
      arr.length ? round2(arr.reduce((sum, x) => sum + toDec(x), 0) / arr.length) : null;
    const dHome = avg(homeOdds);
    const dDraw = avg(drawOdds);
    const dAway = avg(awayOdds);
    if (!dHome || !dDraw || !dAway) return null;
    const iH = 1 / dHome;
    const iD = 1 / dDraw;
    const iA = 1 / dAway;
    const sum = iH + iD + iA;
    return {
      providers: pc.length,
      decimalOdds: { home: dHome, draw: dDraw, away: dAway },
      marketProbPct: {
        home: round1((iH / sum) * 100),
        draw: round1((iD / sum) * 100),
        away: round1((iA / sum) * 100),
      },
    };
  } catch {
    return null;
  }
}
