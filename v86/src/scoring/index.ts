import type { AtgRace, AtgStart } from "../types";
import type { PoolGameType } from "../types";
import type { TravsportIndex } from "../travsport/types";
import { betDistribution } from "../atg-api";
import { scoreDriverChecklist, driverScoreFromItems } from "./driver-checklist";
import { scoreHorseChecklist } from "./horse-checklist";
import type { HorseDriverScores } from "./types";
import { weightedAverage } from "./utils";

export function scoreStartFull(
  start: AtgStart,
  race: AtgRace,
  fieldStarts: AtgStart[],
  gameType: PoolGameType,
  travsportIndex?: TravsportIndex,
): HorseDriverScores {
  const bd = betDistribution(start, gameType);
  const ts = start.horse?.id ? travsportIndex?.[start.horse.id] : undefined;
  const horse = scoreHorseChecklist(start, race, fieldStarts, ts);
  const driver = scoreDriverChecklist(start, race, bd, ts);

  const horseScore = weightedAverage(horse.items);
  const driverScore = driverScoreFromItems(driver.items);
  const combinedScore = horseScore * 0.62 + driverScore * 0.38;

  const highlights = [...horse.highlights, ...driver.highlights].slice(0, 5);

  return {
    horseItems: horse.items,
    driverItems: driver.items,
    horseScore,
    driverScore,
    combinedScore,
    formTrend: horse.formTrend,
    highlights,
  };
}

export type { ChecklistItem, HorseDriverScores } from "./types";
