import type { PoolGameType } from "./types";

/** Endast V85 (lördag) och Dagens Dubbel. */
export const ALLOWED_POOL_GAME_TYPES: readonly PoolGameType[] = ["V85", "dd"] as const;

export function isAllowedGameType(type: string): type is PoolGameType {
  return (ALLOWED_POOL_GAME_TYPES as readonly string[]).includes(type);
}

export function gameTypeLabel(type: string): string {
  if (type === "V85") return "V85";
  if (type === "dd") return "Dagens Dubbel";
  return type;
}

export function rowPriceKr(type: PoolGameType): number {
  return type === "dd" ? 1 : 0.25;
}

export function defaultBudgetKr(type: PoolGameType): number {
  return type === "dd" ? 50 : 400;
}

export function defaultMinPayoutKr(type: PoolGameType): number {
  return type === "dd" ? 5_000 : 30_000;
}
