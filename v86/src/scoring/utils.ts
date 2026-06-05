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

export function distanceClass(meters?: number): "short" | "medium" | "long" | "ultralong" {
  if (!meters) return "medium";
  if (meters < 1700) return "short";
  if (meters < 2200) return "medium";
  if (meters < 2600) return "long";
  return "ultralong";
}

/** Representativt metertal per ATG-distansband, används för km-tidskorrigering. */
export function representativeMeters(band?: string): number {
  if (band === "short") return 1640;
  if (band === "long") return 2640;
  return 2140; // medium default
}

/**
 * Sekundertillägg att lägga till ett km-tidsrekord när källdistansen skiljer sig från loppet.
 * Hästar presterar ~0,4 s/km sämre km-tid per extra kilometer (uthållighetseffekt).
 * Negativt värde = hästen gick rekordet på längre distans → bonus (stayer-effekt).
 */
export function distanceCorrectionSec(sourceMeters: number, raceMeters: number): number {
  return ((raceMeters - sourceMeters) / 1000) * 0.4;
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
