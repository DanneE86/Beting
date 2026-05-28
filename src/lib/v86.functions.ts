import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { PoolGameType, TravRuleId } from "../../v86/src/types";
import { hybridTravsportCache } from "@/lib/travsport-cache-backend";
import {
  backtestTravHistory,
  getTravHistory,
  getTravLearningPrompt,
  resolvePendingTravPredictions,
  saveTravPrediction,
} from "@/lib/trav-learning.server";
import {
  buildSnapshot,
  listGamesForDate,
  pickDefaultPoolGame,
  pickDefaultV85Game,
  todayIso,
} from "../../v86/src/pipeline";
import { DEFAULT_TRAV_RULE_ID, normalizeTravRuleId } from "../../v86/src/rules";
import type { GameOption } from "../../v86/src/pipeline";
import type { FetchSnapshot } from "../../v86/src/types";

export type { FetchSnapshot, GameOption };
export { pickDefaultPoolGame };
export { pickDefaultV85Game, pickDefaultV85Game as pickDefaultV86Game };

export const TRAV_RULE_IDS = ["rule1", "rule2", "rule3", "rule4", "rule5", "rule6"] as const;
export const TRAV_RULE_IDS_WITH_ALL = [...TRAV_RULE_IDS, "all"] as const;

export const v86ListGames = createServerFn({ method: "GET" })
  .inputValidator((d: { date?: string }) =>
    z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }).parse(d),
  )
  .handler(async ({ data }): Promise<{ date: string; games: GameOption[] }> => {
    const date = data.date ?? todayIso();
    const games = await listGamesForDate(date);
    return { date, games };
  });

export const v86Analyze = createServerFn({ method: "POST" })
  .inputValidator(
    (d: {
      date?: string;
      gameId?: string;
      ruleId?: TravRuleId;
      budgetKr?: number;
      targetMinPayoutKr?: number;
      autoBudget?: boolean;
    }) =>
      z
        .object({
          date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
          gameId: z.string().min(1).optional(),
          ruleId: z.enum(TRAV_RULE_IDS).optional(),
          budgetKr: z.number().min(25).max(50_000).optional(),
          targetMinPayoutKr: z.number().min(1_000).max(10_000_000).optional(),
          autoBudget: z.boolean().optional(),
        })
        .parse(d),
  )
  .handler(async ({ data }): Promise<FetchSnapshot> => {
    const snapshot = await buildSnapshot({
      date: data.date,
      gameId: data.gameId,
      ruleId: data.ruleId,
      budgetKr: data.budgetKr,
      targetMinPayoutKr: data.targetMinPayoutKr,
      autoBudget: data.autoBudget,
      includeAndelsspel: false,
      includeTravsport: true,
      travsportDbCache: hybridTravsportCache,
      travsportAllowStaleCache: true,
    });
    const ruleId = snapshot.meta?.rule?.id ?? normalizeTravRuleId(data.ruleId);
    const [predictionId, learningPromptText] = await Promise.all([
      saveTravPrediction(snapshot).catch((error) => {
        console.warn("saveTravPrediction failed:", (error as Error).message);
        return null;
      }),
      getTravLearningPrompt(snapshot.game.type, ruleId).catch(() => null),
    ]);
    return {
      ...snapshot,
      meta: {
        ...snapshot.meta,
        predictionId,
        learningPromptText,
        historySaveError: predictionId
          ? null
          : "Kunde inte spara i historik (kontrollera Supabase-nycklar i produktion).",
      },
    };
  });

export const v86History = createServerFn({ method: "GET" })
  .inputValidator(
    (d: { limit?: number; gameType?: PoolGameType | "all"; ruleId?: TravRuleId | "all" }) =>
      z
        .object({
          limit: z.number().int().min(1).max(100).optional(),
          gameType: z.enum(["V85", "V86", "dd", "all"]).optional(),
          ruleId: z.enum(TRAV_RULE_IDS_WITH_ALL).optional(),
        })
        .parse(d),
  )
  .handler(async ({ data }) => {
    return getTravHistory(
      data.limit ?? 20,
      data.gameType && data.gameType !== "all" ? data.gameType : null,
      data.ruleId && data.ruleId !== "all" ? data.ruleId : null,
    );
  });

export const v86ResolveHistory = createServerFn({ method: "POST" })
  .inputValidator((d: { limit?: number }) => z.object({ limit: z.number().int().min(1).max(100).optional() }).parse(d))
  .handler(async ({ data }) => {
    return resolvePendingTravPredictions(data.limit ?? 20);
  });

export const v86BacktestHistory = createServerFn({ method: "POST" })
  .inputValidator(
    (d: {
      gameType: PoolGameType;
      ruleId?: TravRuleId;
      fromDate: string;
      toDate: string;
      maxGames?: number;
      budgetKr?: number;
      targetMinPayoutKr?: number;
      autoBudget?: boolean;
    }) =>
      z
        .object({
          gameType: z.enum(["V85", "V86", "dd"]),
          ruleId: z.enum(TRAV_RULE_IDS).optional(),
          fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
          toDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
          maxGames: z.number().int().min(1).max(200).optional(),
          budgetKr: z.number().min(25).max(50_000).optional(),
          targetMinPayoutKr: z.number().min(1_000).max(10_000_000).optional(),
          autoBudget: z.boolean().optional(),
        })
        .parse(d),
  )
  .handler(async ({ data }) => {
    return backtestTravHistory({
      ...data,
      ruleId: data.ruleId ?? DEFAULT_TRAV_RULE_ID,
    });
  });
