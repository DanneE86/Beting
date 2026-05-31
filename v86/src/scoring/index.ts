import { betDistribution } from "../atg-api";
import type { AtgRace, AtgStart, TravRuleId } from "../types";
import type { PoolGameType } from "../types";
import type { TravsportIndex } from "../travsport/types";
import { scoreDriverChecklist, driverScoreFromItems } from "./driver-checklist";
import { scoreHorseChecklist } from "./horse-checklist";
import type { HorseDriverScores } from "./types";
import { weightedAverage } from "./utils";
import { travRuleUsesMarketData } from "../rules";

const HORSE_SCORE_WEIGHT = 0.62;
const DRIVER_SCORE_WEIGHT = 0.38;

export function scoreStartFull(
  start: AtgStart,
  race: AtgRace,
  fieldStarts: AtgStart[],
  gameType: PoolGameType,
  travsportIndex?: TravsportIndex,
  ruleId: TravRuleId = "rule1",
): HorseDriverScores {
  const bd = travRuleUsesMarketData(ruleId) ? betDistribution(start, gameType) : 0;
  const ts = start.horse?.id ? travsportIndex?.[start.horse.id] : undefined;
  const horse = scoreHorseChecklist(start, race, fieldStarts, ts);
  const driver = scoreDriverChecklist(start, race, bd, ts);

  const horseScore = weightedAverage(horse.items);
  const driverScore = driverScoreFromItems(driver.items);
  const combinedScore = horseScore * HORSE_SCORE_WEIGHT + driverScore * DRIVER_SCORE_WEIGHT;

  const highlights = [...horse.highlights, ...driver.highlights].slice(0, 5);

  return {
    horseItems: horse.items,
    driverItems: driver.items,
    horseScore,
    driverScore,
    combinedScore,
    formTrend: horse.formTrend,
    highlights,
    tempoTripScore: horse.tempoTripScore,
    tempoTripStyle: horse.tempoTripStyle,
    gallopRiskScore: horse.gallopRiskScore,
    gallopRiskLevel: horse.gallopRiskLevel,
  };
}

export type { ChecklistItem, HorseDriverScores } from "./types";
