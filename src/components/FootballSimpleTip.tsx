import type { BttsCall } from "@/lib/prediction-meta";
import { formatFootballBttsLine } from "@/lib/football-tip";
import type { TipLabel } from "@/lib/match-outcome";

const BTTS_CLASS: Record<Exclude<BttsCall, null | undefined>, string> = {
  ja: "text-emerald-600 dark:text-emerald-400",
  nej: "text-amber-600 dark:text-amber-400",
  osäker: "text-muted-foreground",
};

type Props = {
  tip: TipLabel;
  tipPct?: number | null;
  bttsCall?: BttsCall | null;
  bttsReason?: string | null;
};

/** Fotboll: endast 1X2-tips och BTTS — inget annat. */
export function FootballSimpleTip({ tip, tipPct, bttsCall, bttsReason }: Props) {
  const btts = bttsCall ?? null;
  const bttsLabel = formatFootballBttsLine(btts);

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="rounded-lg border-2 border-primary/50 bg-primary/10 px-4 py-4 text-center">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
          Tippa på
        </p>
        <p className="font-display text-4xl font-bold text-primary leading-none">{tip}</p>
        {tipPct != null && Number.isFinite(tipPct) ? (
          <p className="text-xs text-muted-foreground mt-2">{Math.round(tipPct)}% sannolikhet</p>
        ) : null}
      </div>

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
    </div>
  );
}
