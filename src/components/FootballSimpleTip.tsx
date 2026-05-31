import type { BttsCall } from "@/lib/prediction-meta";
import { formatFootballBttsLine } from "@/lib/football-tip";
import type { TipLabel } from "@/lib/match-outcome";

const BTTS_CLASS: Record<Exclude<BttsCall, null | undefined>, string> = {
  ja: "text-emerald-600 dark:text-emerald-400",
  nej: "text-amber-600 dark:text-amber-400",
  osäker: "text-muted-foreground",
};

const OVER25_CLASS: Record<"ja" | "nej" | "osäker", string> = {
  ja: "text-emerald-600 dark:text-emerald-400",
  nej: "text-amber-600 dark:text-amber-400",
  osäker: "text-muted-foreground",
};

function fmtOdds(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toFixed(2);
}

type Props = {
  tip: TipLabel;
  homeWinPct?: number | null;
  drawPct?: number | null;
  awayWinPct?: number | null;
  /** Fallback om bara ett värde finns */
  tipPct?: number | null;
  bttsCall?: BttsCall | null;
  bttsReason?: string | null;
  over25Pct?: number | null;
  over25Call?: "ja" | "nej" | "osäker" | null;
  /** Marknadodds (decimal) för 1X2 */
  homeOdds?: number | null;
  drawOdds?: number | null;
  awayOdds?: number | null;
  /** Marknadodds för Över/Under 2.5 */
  overUnder?: { line: number; overOdds: number | null; underOdds: number | null } | null;
};

/** Fotboll: 1X2-tips, BTTS och Över 2.5 — med marknadodds. */
export function FootballSimpleTip({
  tip,
  homeWinPct,
  drawPct,
  awayWinPct,
  tipPct,
  bttsCall,
  bttsReason,
  over25Pct,
  over25Call,
  homeOdds,
  drawOdds,
  awayOdds,
  overUnder,
}: Props) {
  const btts = bttsCall ?? null;
  const bttsLabel = formatFootballBttsLine(btts);

  const hasAllProbs =
    homeWinPct != null && Number.isFinite(homeWinPct) &&
    drawPct != null && Number.isFinite(drawPct) &&
    awayWinPct != null && Number.isFinite(awayWinPct);

  const fallbackPct = tipPct != null && Number.isFinite(tipPct) ? tipPct : null;
  const hasOdds = homeOdds != null || drawOdds != null || awayOdds != null;
  const over25Label = over25Call === "ja" ? "Ja" : over25Call === "nej" ? "Nej" : over25Call === "osäker" ? "Osäker" : "—";

  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {/* 1X2 */}
      <div className="rounded-lg border-2 border-primary/50 bg-primary/10 px-4 py-4 text-center">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
          Tippa på
        </p>
        <p className="font-display text-4xl font-bold text-primary leading-none">{tip}</p>
        {hasAllProbs ? (
          <div className="flex justify-center gap-3 text-xs mt-2 tabular-nums">
            <span className={tip === "1" ? "font-semibold text-primary" : "text-muted-foreground"}>
              1 · {Math.round(homeWinPct!)}%
            </span>
            <span className={tip === "X" ? "font-semibold text-primary" : "text-muted-foreground"}>
              X · {Math.round(drawPct!)}%
            </span>
            <span className={tip === "2" ? "font-semibold text-primary" : "text-muted-foreground"}>
              2 · {Math.round(awayWinPct!)}%
            </span>
          </div>
        ) : fallbackPct != null ? (
          <p className="text-xs text-muted-foreground mt-2">{Math.round(fallbackPct)}% sannolikhet</p>
        ) : null}
        {hasOdds && (
          <div className="flex justify-center gap-2 text-[11px] mt-2 tabular-nums text-muted-foreground border-t border-border/40 pt-2">
            <span className={tip === "1" ? "font-semibold text-foreground" : ""}>{fmtOdds(homeOdds)}</span>
            <span className="opacity-40">/</span>
            <span className={tip === "X" ? "font-semibold text-foreground" : ""}>{fmtOdds(drawOdds)}</span>
            <span className="opacity-40">/</span>
            <span className={tip === "2" ? "font-semibold text-foreground" : ""}>{fmtOdds(awayOdds)}</span>
          </div>
        )}
      </div>

      {/* Båda lagen gör mål */}
      <div className="rounded-lg border border-border bg-secondary/30 px-4 py-4 text-center">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
          Båda lagen gör mål
        </p>
        <p
          className={`font-display text-2xl font-bold uppercase ${
            btts ? BTTS_CLASS[btts] : "text-muted-foreground"
          }`}
        >
          {bttsLabel}
        </p>
        {bttsReason?.trim() ? (
          <p className="text-[11px] text-muted-foreground mt-2 leading-snug">{bttsReason}</p>
        ) : null}
      </div>

      {/* Över 2.5 mål */}
      <div className="rounded-lg border border-border bg-secondary/30 px-4 py-4 text-center">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
          Över 2.5 mål
        </p>
        <p
          className={`font-display text-2xl font-bold uppercase ${
            over25Call ? OVER25_CLASS[over25Call] : "text-muted-foreground"
          }`}
        >
          {over25Label}
        </p>
        {over25Pct != null && Number.isFinite(over25Pct) ? (
          <p className="text-xs text-muted-foreground mt-1">
            Modell: {Math.round(over25Pct)}%
          </p>
        ) : null}
        {overUnder ? (
          <div className="text-[11px] text-muted-foreground mt-2 border-t border-border/40 pt-2 tabular-nums space-y-0.5">
            <div>Linje: {overUnder.line}</div>
            <div className="flex justify-center gap-2">
              <span>Ö {fmtOdds(overUnder.overOdds)}</span>
              <span className="opacity-40">/</span>
              <span>U {fmtOdds(overUnder.underOdds)}</span>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
