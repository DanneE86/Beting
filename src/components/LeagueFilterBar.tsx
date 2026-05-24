/**
 * Återanvändbar knappradsfilter för ligor.
 * Visar "Alla ligor" + en knapp per liga; samma stil som live-filtret på startsidan.
 */
export type LeagueFilterItem = { id: string; name: string };

type Props = {
  value: string; // "all" eller liga-id
  onChange: (id: string) => void;
  leagues: LeagueFilterItem[];
  label?: string;
  allLabel?: string;
  className?: string;
};

export function LeagueFilterBar({
  value,
  onChange,
  leagues,
  label = "Filter",
  allLabel = "Alla ligor",
  className = "flex flex-wrap items-center gap-2",
}: Props) {
  if (leagues.length === 0) return null;
  const cls = (active: boolean) =>
    `px-3 py-1.5 rounded-md text-xs font-medium border transition ${
      active
        ? "bg-primary text-primary-foreground border-primary"
        : "bg-card border-border hover:border-primary/50"
    }`;
  return (
    <div className={className}>
      {label && (
        <span className="text-xs uppercase tracking-widest text-muted-foreground mr-1">
          {label}
        </span>
      )}
      <button onClick={() => onChange("all")} className={cls(value === "all")}>
        {allLabel}
      </button>
      {leagues.map((lg) => (
        <button
          key={lg.id}
          onClick={() => onChange(lg.id)}
          className={cls(value === lg.id)}
        >
          {lg.name}
        </button>
      ))}
    </div>
  );
}
