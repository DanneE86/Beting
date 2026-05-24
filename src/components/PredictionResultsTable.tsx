import { Fragment } from "react";
import { Badge } from "@/components/ui/badge";
import { Brain } from "lucide-react";
import { MatchDateTime } from "@/components/MatchDateTime";
import { BttsDisplay } from "@/components/BttsDisplay";
import { extractBtts } from "@/lib/prediction-meta";
import { outcomeToTip, isExactScore } from "@/lib/match-outcome";
import type { BttsCall, PredictionListRow, PostmortemData } from "@/lib/prediction-types";

export type PredictionRow = PredictionListRow;

type Props = {
  rows: PredictionRow[];
  /** Visa kolumn för liga */
  showLeague?: boolean;
  /** Visa kolumn för Båda mål (BTTS) */
  showBtts?: boolean;
  /** Hur datumcellen formateras under matchen */
  dateFormat?: "date" | "time";
  /** Slå upp läsbart liganamn när showLeague=true */
  leagueNameOf?: (id: string) => string;
  /** Visa "Väntar"-badge när actual_outcome saknas (annars antas resultat finnas) */
  allowPending?: boolean;
};

export function PredictionResultsTable({
  rows,
  showLeague = false,
  showBtts = false,
  dateFormat = "date",
  leagueNameOf,
  allowPending = false,
}: Props) {
  // Räkna kolumner dynamiskt: Match, [Liga], Tips, [Båda mål], Pred, Conf, Facit, Status
  const cols =
    2 /* match + tips */ +
    (showLeague ? 1 : 0) +
    (showBtts ? 1 : 0) +
    1 /* pred */ +
    1 /* conf */ +
    1 /* facit */ +
    1; /* status */

  return (
    <div className="w-full overflow-x-auto [container-type:inline-size]">
      <table className="w-full text-sm">
        <thead className="text-muted-foreground text-xs">
          <tr>
            <th className="text-left px-4 py-2">Match</th>
            {showLeague && <th className="px-2 py-2">Liga</th>}
            <th className="px-2 py-2">Tips</th>
            {showBtts && <th className="px-2 py-2">Båda mål</th>}
            <th className="px-2 py-2">Pred.</th>
            <th className="px-2 py-2">Conf.</th>
            <th className="px-2 py-2">Facit</th>
            <th className="px-2 py-2 text-right pr-4">Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const hit1x2 =
              !!r.actual_outcome && r.actual_outcome === r.predicted_outcome;
            const exactScore = isExactScore(
              r.predicted_score,
              r.actual_home_score,
              r.actual_away_score,
            );
            const lgName =
              showLeague && leagueNameOf && r.league_id
                ? leagueNameOf(r.league_id)
                : r.league_id ?? "";

            const tip = outcomeToTip(r.predicted_outcome);

            const rawDate = r.event_date ?? r.created_at ?? null;
            const dateTimeVariant: "time-date" | "date" =
              dateFormat === "time" ? "time-date" : "date";
            const roundSuffix = r.round != null ? `Omg. ${r.round}` : null;

            const btts = extractBtts(r);

            return (
              <Fragment key={r.id}>
                <tr
                  className={`border-t border-border/60 ${
                    exactScore
                      ? "bg-green-400/25"
                      : hit1x2
                        ? "bg-green-600/15"
                        : ""
                  }`}
                >
                  <td className="px-4 py-2">
                    <div className="font-medium">
                      {r.home_name} – {r.away_name}
                    </div>
                    {rawDate && (
                      <MatchDateTime
                        value={rawDate}
                        variant={dateTimeVariant}
                        suffix={roundSuffix}
                        className="text-xs text-muted-foreground"
                      />
                    )}
                  </td>

                  {showLeague && (
                    <td className="text-center px-2 py-2 text-xs text-muted-foreground">
                      {lgName}
                    </td>
                  )}
                  <td className="text-center px-2 py-2 font-display">{tip}</td>
                  {showBtts && (
                    <td className="text-center px-2 py-2 text-xs">
                      <BttsDisplay call={btts.call} variant="badge" />
                    </td>
                  )}
                  <td className="text-center px-2 py-2 tabular-nums text-xs text-muted-foreground">
                    {r.predicted_score ?? "—"}
                  </td>
                  <td className="text-center px-2 py-2 text-xs text-muted-foreground">
                    {r.confidence ?? "—"}
                  </td>
                  <td className="text-center px-2 py-2 tabular-nums">
                    {r.actual_outcome
                      ? `${r.actual_home_score}-${r.actual_away_score}`
                      : "—"}
                  </td>
                  <td className="text-right pr-4 px-2 py-2">
                    {r.actual_outcome ? (
                      <div className="flex flex-col items-end gap-1">
                        <Badge
                          className={
                            hit1x2
                              ? "bg-green-500/25 text-green-300 border-0"
                              : "bg-destructive/20 text-destructive border-0"
                          }
                        >
                          {hit1x2 ? "Rätt 1X2" : "Fel 1X2"}
                        </Badge>
                        <span
                          className={`text-[10px] ${
                            exactScore
                              ? "text-green-300"
                              : hit1x2
                                ? "text-green-400/80"
                                : "text-muted-foreground"
                          }`}
                          title="Exakt resultat är bonus — viktigast är 1X2."
                        >
                          {exactScore ? "✓ exakt resultat" : "resultat off"}
                        </span>
                      </div>
                    ) : allowPending ? (
                      <Badge variant="outline" className="text-xs">
                        Väntar
                      </Badge>
                    ) : (
                      <span className="text-muted-foreground text-xs">—</span>
                    )}
                  </td>
                </tr>
                {r.actual_outcome ? (
                  <PostmortemRow postmortem={r.postmortem} colSpan={cols} eventDate={r.event_date ?? r.created_at ?? null} />
                ) : (
                  <PrematchAnalysisRow
                    keyFactors={r.key_factors}
                    bettingTip={r.betting_tip}
                    bttsCall={btts.call}
                    bttsReason={btts.reason}
                    homePct={r.home_win_pct}
                    drawPct={r.draw_pct}
                    awayPct={r.away_win_pct}
                    homeName={r.home_name}
                    awayName={r.away_name}
                    colSpan={cols}
                  />
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function PrematchAnalysisRow({
  keyFactors,
  bettingTip,
  bttsCall,
  bttsReason,
  homePct,
  drawPct,
  awayPct,
  homeName,
  awayName,
  colSpan,
}: {
  keyFactors: unknown;
  bettingTip: string | null | undefined;
  bttsCall: "ja" | "nej" | "osäker" | null;
  bttsReason: string | null;
  homePct?: number | string | null;
  drawPct?: number | string | null;
  awayPct?: number | string | null;
  homeName?: string;
  awayName?: string;
  colSpan: number;
}) {
  const factors = Array.isArray(keyFactors)
    ? (keyFactors as unknown[]).map(String).filter(Boolean)
    : [];
  const h = Number(homePct);
  const d = Number(drawPct);
  const a = Number(awayPct);
  const hasPcts = isFinite(h) && isFinite(d) && isFinite(a) && (h + d + a) > 0;
  const fmtPct = (n: number) => `${Math.round(n)}%`;
  const top = hasPcts ? Math.max(h, d, a) : 0;
  const hasContent = factors.length > 0 || !!bettingTip || !!bttsReason || hasPcts;
  if (!hasContent) {
    return (
      <tr className="border-t border-border/30 bg-muted/10">
        <td colSpan={colSpan} className="p-0">
          <div className="sticky left-0 w-[100cqi] px-4 py-2 text-[11px] text-muted-foreground italic">
            Ingen analys sparad för detta tips ännu.
          </div>
        </td>
      </tr>
    );
  }
  return (
    <tr className="border-t border-border/30 bg-muted/10">
      <td colSpan={colSpan} className="p-0">
        <div className="sticky left-0 w-[100cqi] px-3 py-3 sm:px-4">
          <details className="text-xs">
            <summary className="cursor-pointer select-none flex items-start gap-2 text-muted-foreground hover:text-foreground flex-wrap">
              <Brain className="w-3 h-3 mt-0.5 shrink-0 text-primary" />
              <span className="font-medium shrink-0">Analys:</span>
              {hasPcts && (
                <span className="inline-flex items-center gap-1.5 tabular-nums text-[11px] shrink-0">
                  <span className={`px-1.5 py-0.5 rounded ${h === top ? "bg-primary/20 text-primary font-medium" : "bg-secondary/60 text-muted-foreground"}`}>
                    1 {fmtPct(h)}
                  </span>
                  <span className={`px-1.5 py-0.5 rounded ${d === top ? "bg-primary/20 text-primary font-medium" : "bg-secondary/60 text-muted-foreground"}`}>
                    X {fmtPct(d)}
                  </span>
                  <span className={`px-1.5 py-0.5 rounded ${a === top ? "bg-primary/20 text-primary font-medium" : "bg-secondary/60 text-muted-foreground"}`}>
                    2 {fmtPct(a)}
                  </span>
                </span>
              )}
              <span className="text-foreground/90 break-words">
                {bettingTip ?? factors[0] ?? "Visa nyckelfaktorer"}
              </span>
            </summary>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {hasPcts && (homeName || awayName) && (
                <div className="min-w-0 sm:col-span-2">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                    Sannolikhet 1X2
                  </div>
                  <div className="flex items-center gap-2 text-xs tabular-nums">
                    <span className="shrink-0 text-foreground/80">{homeName ?? "Hemma"}</span>
                    <div className="flex-1 flex h-2 rounded overflow-hidden bg-secondary/40 min-w-[120px]">
                      <div style={{ width: `${h}%` }} className="bg-primary/70" title={`1 ${fmtPct(h)}`} />
                      <div style={{ width: `${d}%` }} className="bg-amber-400/60" title={`X ${fmtPct(d)}`} />
                      <div style={{ width: `${a}%` }} className="bg-destructive/60" title={`2 ${fmtPct(a)}`} />
                    </div>
                    <span className="shrink-0 text-foreground/80">{awayName ?? "Borta"}</span>
                  </div>
                  <div className="flex gap-3 mt-1 text-[10px] text-muted-foreground">
                    <span>1 {fmtPct(h)}</span>
                    <span>X {fmtPct(d)}</span>
                    <span>2 {fmtPct(a)}</span>
                  </div>
                </div>
              )}
              {factors.length > 0 && (
                <div className="min-w-0">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                    Nyckelfaktorer
                  </div>
                  <ul className="list-disc list-inside space-y-1 text-foreground/80 break-words">
                    {factors.map((f, i) => (
                      <li key={i}>{f}</li>
                    ))}
                  </ul>
                </div>
              )}
              <div className="min-w-0 space-y-2">
                {bettingTip && (
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                      Speltips
                    </div>
                    <div className="text-foreground/90 break-words">
                      {bettingTip}
                    </div>
                  </div>
                )}
                {bttsReason && (
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                      Båda mål ({bttsCall ?? "—"})
                    </div>
                    <div className="text-foreground/80 break-words">
                      {bttsReason}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </details>
        </div>
      </td>
    </tr>
  );
}

export function PostmortemRow({
  postmortem,
  colSpan,
  eventDate,
}: {
  postmortem: unknown;
  colSpan: number;
  eventDate?: string | null;
}) {
  const pm = postmortem as PostmortemData;
  const dateLabel = (() => {
    if (!eventDate) return "";
    const d = new Date(eventDate);
    if (isNaN(d.getTime())) return "";
    return d.toLocaleDateString("sv-SE", {
      weekday: "short",
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  })();
  if (!pm || !pm.summary) {
    return (
      <tr className="border-t border-border/30 bg-muted/10">
        <td colSpan={colSpan} className="p-0">
          <div className="sticky left-0 w-[100cqi] px-4 py-2 text-[11px] text-muted-foreground italic">
            {dateLabel && <span className="not-italic mr-2 text-foreground/70">Spelad: {dateLabel}</span>}
            Analys genereras nästa gång du klickar "Uppdatera resultat".
          </div>
        </td>
      </tr>
    );
  }
  const isWrong = pm.verdict === "wrong";
  const luckColor =
    pm.luck?.level === "hög"
      ? "text-amber-300"
      : pm.luck?.level === "medel"
        ? "text-amber-400/80"
        : "text-muted-foreground";
  return (
    <tr
      className={`border-t border-border/30 ${
        isWrong ? "bg-destructive/5" : "bg-muted/10"
      }`}
    >
      <td colSpan={colSpan} className="p-0">
        <div className="sticky left-0 w-[100cqi] px-3 py-3 sm:px-4">
          <details className="text-xs" open={isWrong}>
            <summary className="cursor-pointer select-none flex items-start gap-2 text-muted-foreground hover:text-foreground flex-wrap">
              <Brain
                className={`w-3 h-3 mt-0.5 shrink-0 ${
                  isWrong ? "text-destructive" : ""
                }`}
              />
              <span className="font-medium shrink-0">
                {isWrong ? "Felanalys:" : "Lärdom:"}
              </span>
              {dateLabel && (
                <span className="shrink-0 text-[11px] px-1.5 py-0.5 rounded bg-secondary/60 text-foreground/80 tabular-nums">
                  {dateLabel}
                </span>
              )}
              <span className="text-foreground/90 break-words">{pm.summary}</span>
            </summary>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 md:grid-cols-3">
              {pm.why && pm.why.length > 0 && (
                <div className="min-w-0">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                    Varför blev det så
                  </div>
                  <ul className="list-disc list-inside space-y-1 text-foreground/80 break-words">
                    {pm.why.map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                </div>
              )}
              {pm.luck && (
                <div className="min-w-0">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                    Turfaktor
                  </div>
                  <div className={`font-display ${luckColor}`}>
                    {pm.luck.level ?? "—"}
                  </div>
                  {pm.luck.reason && (
                    <div className="text-foreground/70 mt-1 break-words">
                      {pm.luck.reason}
                    </div>
                  )}
                </div>
              )}
              {pm.lessons && pm.lessons.length > 0 && (
                <div className="min-w-0">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                    Lärdomar framåt
                  </div>
                  <ul className="list-disc list-inside space-y-1 text-foreground/80 break-words">
                    {pm.lessons.map((l, i) => (
                      <li key={i}>{l}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
            {isWrong &&
              (pm.model_mistakes?.length ||
                pm.signals_missed?.length ||
                pm.alternative_pick) && (
                <div className="mt-3 grid gap-3 sm:grid-cols-2 border-t border-destructive/20 pt-3">
                  {pm.model_mistakes && pm.model_mistakes.length > 0 && (
                    <div className="min-w-0">
                      <div className="text-[10px] uppercase tracking-wider text-destructive/80 mb-1">
                        Modellens felbedömningar
                      </div>
                      <ul className="list-disc list-inside space-y-1 text-foreground/80 break-words">
                        {pm.model_mistakes.map((m, i) => (
                          <li key={i}>{m}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {pm.signals_missed && pm.signals_missed.length > 0 && (
                    <div className="min-w-0">
                      <div className="text-[10px] uppercase tracking-wider text-destructive/80 mb-1">
                        Missade signaler
                      </div>
                      <ul className="list-disc list-inside space-y-1 text-foreground/80 break-words">
                        {pm.signals_missed.map((s, i) => (
                          <li key={i}>{s}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {pm.alternative_pick && (
                    <div className="min-w-0 sm:col-span-2">
                      <div className="text-[10px] uppercase tracking-wider text-destructive/80 mb-1">
                        Borde tippat
                      </div>
                      <div className="text-foreground/90 break-words">
                        {pm.alternative_pick}
                      </div>
                    </div>
                  )}
                </div>
              )}
            {pm.match_stats && (
              <div className="mt-3 flex flex-wrap gap-3 text-[10px] text-muted-foreground tabular-nums">
                {pm.match_stats.shots && (
                  <span>
                    Skott: {pm.match_stats.shots.home}–
                    {pm.match_stats.shots.away}
                  </span>
                )}
                {pm.match_stats.shotsOnTarget && (
                  <span>
                    På mål: {pm.match_stats.shotsOnTarget.home}–
                    {pm.match_stats.shotsOnTarget.away}
                  </span>
                )}
                {pm.match_stats.possession && (
                  <span>
                    Boll: {pm.match_stats.possession.home}–
                    {pm.match_stats.possession.away}%
                  </span>
                )}
              </div>
            )}
          </details>
        </div>
      </td>
    </tr>
  );
}
