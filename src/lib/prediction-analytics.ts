export type ConfidenceBucket = { n: number; hits: number };

export function confidenceRank(c: string | null | undefined): number {
  if (c === "hög") return 3;
  if (c === "medel") return 2;
  if (c === "låg") return 1;
  return 0;
}

export function tallyConfidence(
  byConfidence: Record<string, ConfidenceBucket>,
  confidence: string | null | undefined,
  hit: boolean,
): void {
  const c = confidence ?? "okänd";
  byConfidence[c] ??= { n: 0, hits: 0 };
  byConfidence[c].n++;
  if (hit) byConfidence[c].hits++;
}

export type OutcomeBucket = { n: number; hits: number };

export function tallyOutcome(
  byOutcome: Record<"H" | "D" | "A", OutcomeBucket>,
  predicted: string,
  hit: boolean,
): void {
  const o = predicted as "H" | "D" | "A";
  if (!byOutcome[o]) return;
  byOutcome[o].n++;
  if (hit) byOutcome[o].hits++;
}

export function emptyOutcomeBuckets(): Record<"H" | "D" | "A", OutcomeBucket> {
  return {
    H: { n: 0, hits: 0 },
    D: { n: 0, hits: 0 },
    A: { n: 0, hits: 0 },
  };
}
