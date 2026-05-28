import type { SnapshotRaceStartData } from "../../v86/src/types";

function horseLabel(start: SnapshotRaceStartData): string {
  const name = start.horse?.name?.trim();
  return name ? `${start.number} ${name}` : `nr ${start.number}`;
}

function driverLabel(start: SnapshotRaceStartData): string | null {
  const d = start.driver;
  if (!d) return null;
  const name =
    d.shortName?.trim() ||
    [d.firstName, d.lastName].filter(Boolean).join(" ").trim() ||
    null;
  return name;
}

type Props = {
  starts?: SnapshotRaceStartData[] | null;
  /** Nummer från ATG scratchings-lista om starts saknar scratched-flagga */
  scratchingNumbers?: number[] | null;
  /** Kompakt rad för systemkort (markeringar per avd) */
  variant?: "default" | "compact";
};

function buildScratchedItems(
  starts: SnapshotRaceStartData[] | null | undefined,
  scratchingNumbers: number[] | null | undefined,
) {
  const fromStarts = (starts ?? []).filter((s) => s.scratched);
  const scratchSet = new Set(fromStarts.map((s) => s.number));
  const extraNums = (scratchingNumbers ?? []).filter((n) => !scratchSet.has(n));

  const items: Array<{ number: number; label: string; driver?: string | null }> = fromStarts.map(
    (s) => ({
      number: s.number,
      label: horseLabel(s),
      driver: driverLabel(s),
    }),
  );

  for (const n of extraNums) {
    items.push({ number: n, label: `nr ${n}`, driver: null });
  }

  items.sort((a, b) => a.number - b.number);
  return items;
}

/** Visar strukna hästar under ett lopp — enkel rad per avdelning. */
export function LegScratchedHorses({
  starts,
  scratchingNumbers,
  variant = "default",
}: Props) {
  const items = buildScratchedItems(starts, scratchingNumbers);

  if (!items.length) return null;

  if (variant === "compact") {
    const line = items
      .map((item) => {
        const short = item.label.replace(/^(\d+)\s+/, "$1 ");
        return item.driver ? `${short} (${item.driver})` : short;
      })
      .join(", ");
    return (
      <p className="mt-1.5 text-[10px] leading-snug text-amber-300/85">
        <span className="font-medium text-amber-400/90">Strukna: </span>
        <span className="line-through decoration-amber-500/50">{line}</span>
      </p>
    );
  }

  return (
    <div className="mb-3 rounded-md border border-amber-600/35 bg-amber-950/25 px-3 py-2">
      <p className="text-[10px] font-medium uppercase tracking-wider text-amber-400/95">
        Strukna ({items.length})
      </p>
      <ul className="mt-1.5 space-y-1">
        {items.map((item) => (
          <li
            key={item.number}
            className="flex flex-wrap items-baseline gap-x-2 text-sm text-amber-100/90"
          >
            <span className="font-mono font-semibold text-amber-300/90 line-through decoration-amber-500/60">
              {item.label}
            </span>
            {item.driver ? (
              <span className="text-xs text-amber-200/70">({item.driver})</span>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
