import type { SystemHitOutlook } from "../../v86/src/types";
import { formatHitPct } from "../../v86/src/system-probability";

type Props = {
  outlook: SystemHitOutlook | undefined;
  gameType: string;
  leg?: number;
};

export function SystemHitOutlookSummary({ outlook, gameType }: Pick<Props, "outlook" | "gameType">) {
  if (!outlook) return null;

  const isDd = gameType === "dd";
  const rowLabel = isDd ? "DD-raden" : "Hela raden";

  return (
    <div className="flex shrink-0 flex-col items-end text-right">
      <p className="text-[10px] font-medium uppercase tracking-wider text-[#7fa892]">
        {rowLabel} går in
      </p>
      <p className="font-mono text-2xl font-semibold tabular-nums text-[#5ec98a]">
        {formatHitPct(outlook.fullRowHitPct, outlook.fullRowHitPct < 0.01 ? 2 : 1)}
      </p>
      <p className="mt-1 max-w-[220px] text-[10px] leading-snug text-[#b8f0d0]">
        Modellens approx. chans att minst en markerad häst vinner i varje avdelning
        (oberoende lopp).
      </p>
    </div>
  );
}

export function LegHitPctBadge({ outlook, leg }: Pick<Props, "outlook" | "leg">) {
  if (!outlook || leg == null) return null;
  const legOutlook = outlook.legs.find((item) => item.leg === leg);
  if (!legOutlook) return null;

  return (
    <span
      className="rounded border border-[#2d6b45] bg-[#0c1410] px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-[#5ec98a]"
      title="Sannolikhet att någon av dina markerade hästar vinner avdelningen"
    >
      {formatHitPct(legOutlook.hitPct)} träff
    </span>
  );
}

export function BiggestRiskNote({ outlook }: Pick<Props, "outlook">) {
  if (!outlook) return null;

  return (
    <div className="mt-3 rounded-md border border-amber-700/30 bg-amber-950/20 px-3 py-2">
      <p className="text-[10px] font-medium uppercase tracking-wider text-amber-400/90">
        Största risken · avd {outlook.biggestRisk.leg} (~{formatHitPct(outlook.biggestRisk.hitPct)})
      </p>
      <p className="mt-1 text-xs leading-relaxed text-amber-100/90">{outlook.biggestRisk.reason}</p>
    </div>
  );
}

export function LegTipHitNote({
  outlook,
  leg,
  picks,
}: {
  outlook: SystemHitOutlook | undefined;
  leg: number;
  picks: number[] | undefined;
}) {
  if (!outlook || !picks?.length) return null;
  const legOutlook = outlook.legs.find((item) => item.leg === leg);
  if (!legOutlook) return null;

  return (
    <p className="mb-2 text-xs text-[#b8f0d0]">
      <span className="font-medium text-[#5ec98a]">
        Dina markeringar ({picks.join(", ")}):
      </span>{" "}
      ~{formatHitPct(legOutlook.hitPct)} sannolikhet att avdelningen träffas enligt modellen.
    </p>
  );
}
