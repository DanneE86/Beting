export function pctFromAtg(raw?: number): number {
  if (raw == null) return 0;
  return raw / 100;
}

export function recordToSeconds(t?: {
  minutes?: number;
  seconds?: number;
  tenths?: number;
}): number | null {
  if (!t) return null;
  return (t.minutes ?? 0) * 60 + (t.seconds ?? 0) + (t.tenths ?? 0) / 10;
}

export function distanceBand(meters?: number): "short" | "medium" | "long" {
  if (!meters) return "medium";
  if (meters < 1700) return "short";
  if (meters < 2200) return "medium";
  return "long";
}

export function weightedAverage(
  items: { score: number; weight: number; available: boolean }[],
): number {
  let wSum = 0;
  let sSum = 0;
  for (const i of items) {
    if (!i.available) continue;
    wSum += i.weight;
    sSum += i.score * i.weight;
  }
  return wSum > 0 ? sSum / wSum : 0.5;
}

export function placementRate(placement?: { "1"?: number; "2"?: number; "3"?: number }, starts?: number): number {
  if (!placement || !starts || starts <= 0) return 0;
  const top3 = (placement["1"] ?? 0) + (placement["2"] ?? 0) + (placement["3"] ?? 0);
  return top3 / starts;
}
