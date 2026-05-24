import type { MatchAnalysisSections } from "@/lib/match-analysis";

const SECTIONS: { key: keyof MatchAnalysisSections; label: string }[] = [
  { key: "grundlaggande", label: "Grundläggande matchanalys" },
  { key: "btts", label: "BTTS-fokus" },
  { key: "oneXtwo", label: "1X2-fokus" },
  { key: "h2h", label: "Head-to-head & historik" },
  { key: "lagnyheter", label: "Lagnyheter & upplägg" },
  { key: "ovrigt", label: "Övriga faktorer" },
];

export function extractMatchAnalysis(
  postmortem: unknown,
): MatchAnalysisSections | null {
  const pm = postmortem as { matchAnalysis?: MatchAnalysisSections } | null | undefined;
  if (!pm?.matchAnalysis) return null;
  const m = pm.matchAnalysis;
  if (!m.grundlaggande && !m.btts && !m.oneXtwo) return null;
  return m;
}

export function MatchAnalysisDisplay({
  analysis,
  compact = false,
}: {
  analysis: MatchAnalysisSections;
  compact?: boolean;
}) {
  return (
    <div className={`space-y-2 ${compact ? "text-xs" : "text-sm"}`}>
      {SECTIONS.map(({ key, label }) => {
        const text = analysis[key]?.trim();
        if (!text) return null;
        return (
          <div key={key} className="rounded-md border border-border/60 bg-secondary/30 px-3 py-2">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
              {label}
            </div>
            <p className="text-foreground/90 leading-relaxed break-words">{text}</p>
          </div>
        );
      })}
    </div>
  );
}
