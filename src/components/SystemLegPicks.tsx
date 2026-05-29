import type { LegAnalysis } from "../../v86/src/types";

type Props = {
  leg: LegAnalysis | undefined;
  picks: number[];
};

export function SystemLegPicksWithOdds({ leg, picks }: Props) {
  return (
    <>
      <p className="mt-1 font-mono text-lg text-[#d4f5e2]">{picks.join(", ")}</p>
      <ul className="mt-2 space-y-1 border-t border-[#1e3d2a] pt-2">
        {picks.map((number) => {
          const horse = leg?.horses.find((h) => h.number === number);
          return (
            <li key={number} className="flex items-baseline justify-between gap-2 text-xs">
              <span className="min-w-0 text-[#e8f0ea]">
                <span className="font-mono text-[#5ec98a]">{number}.</span> {horse?.name ?? "—"}
              </span>
              <span className="shrink-0 text-right tabular-nums text-[#7fa892]">
                {horse?.winOdds != null ? (
                  <span className="text-[#d4f5e2]">odds {horse.winOdds.toFixed(2)}</span>
                ) : (
                  <span>odds —</span>
                )}
                {horse != null && horse.betDistribution > 0 ? (
                  <span className="ml-1">· {horse.betDistribution.toFixed(1)}%</span>
                ) : null}
              </span>
            </li>
          );
        })}
      </ul>
    </>
  );
}

export function formatHorseOddsLine(horse: {
  winOdds: number | null;
  betDistribution: number;
}): string {
  const parts: string[] = [];
  if (horse.winOdds != null) parts.push(`odds ${horse.winOdds.toFixed(2)}`);
  if (horse.betDistribution > 0) parts.push(`${horse.betDistribution.toFixed(1)}%`);
  return parts.length > 0 ? parts.join(" · ") : "—";
}
