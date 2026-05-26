import type { PoolGameType } from "./types";

/** V85, V86 och Dagens Dubbel. */
export const ALLOWED_POOL_GAME_TYPES: readonly PoolGameType[] = ["V85", "V86", "dd"] as const;

export function isAllowedGameType(type: string): type is PoolGameType {
  return (ALLOWED_POOL_GAME_TYPES as readonly string[]).includes(type);
}

export function gameTypeLabel(type: string): string {
  if (type === "V85") return "V85";
  if (type === "V86") return "V86";
  if (type === "dd") return "Dagens Dubbel";
  return type;
}

export function rowPriceKr(type: PoolGameType): number {
  return type === "dd" ? 1 : 0.5;
}

export function defaultBudgetKr(type: PoolGameType): number {
  return type === "dd" ? 50 : 600;
}

export function defaultMinPayoutKr(type: PoolGameType): number {
  return type === "dd" ? 5_000 : 30_000;
}
