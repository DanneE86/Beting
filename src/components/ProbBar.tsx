/**
 * Återanvändbar 1X2-sannolikhetsstapel.
 * Visar en horisontell stapel med tre segment (hemma / oavgjort / borta)
 * plus procentlabels under. Används överallt där 1X2 ska visualiseras.
 */
type Props = {
  home: number;
  draw: number;
  away: number;
  /** Visa procent under stapeln (default true) */
  showLabels?: boolean;
  className?: string;
};

export function ProbBar({ home, draw, away, showLabels = true, className }: Props) {
  const total = home + draw + away || 100;
  const seg = (n: number) => `${(n / total) * 100}%`;
  return (
    <div className={className}>
      <div className="flex h-2 rounded-full overflow-hidden bg-secondary">
        <div className="bg-primary" style={{ width: seg(home) }} />
        <div className="bg-muted-foreground/40" style={{ width: seg(draw) }} />
        <div className="bg-live" style={{ width: seg(away) }} />
      </div>
      {showLabels && (
        <div className="flex justify-between text-xs mt-1.5 tabular-nums">
          <span>1 · {Math.round(home)}%</span>
          <span>X · {Math.round(draw)}%</span>
          <span>2 · {Math.round(away)}%</span>
        </div>
      )}
    </div>
  );
}
