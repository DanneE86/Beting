import type { BttsCall } from "@/lib/prediction-meta";

const BTTS_STYLES: Record<BttsCall, string> = {
  ja: "bg-green-500/20 text-green-300",
  nej: "bg-destructive/15 text-destructive",
  osäker: "bg-secondary text-muted-foreground",
};

type Props = {
  call: BttsCall | null | undefined;
  reason?: string | null;
  /** panel = bordered box, badge = tabell-pill, inline = text only */
  variant?: "panel" | "badge" | "inline";
};

export function BttsDisplay({ call, reason, variant = "badge" }: Props) {
  if (!call) {
    return variant === "badge" ? (
      <span className="text-muted-foreground">—</span>
    ) : null;
  }

  if (variant === "badge") {
    return (
      <span className={`px-2 py-0.5 rounded uppercase font-medium ${BTTS_STYLES[call]}`}>
        {call}
      </span>
    );
  }

  if (variant === "inline") {
    return reason ? (
      <span className="text-foreground/80 break-words">{reason}</span>
    ) : (
      <span className="uppercase font-medium">{call}</span>
    );
  }

  return (
    <div
      className={`rounded-md border px-3 py-2 text-xs ${
        call === "ja"
          ? "border-emerald-500/40 bg-emerald-500/10"
          : call === "nej"
            ? "border-amber-500/40 bg-amber-500/10"
            : "border-border bg-secondary/40"
      }`}
    >
      <strong>Båda mål: {call.toUpperCase()}</strong>
      {reason ? <span className="block mt-0.5 opacity-90">{reason}</span> : null}
    </div>
  );
}
