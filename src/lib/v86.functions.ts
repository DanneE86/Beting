import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  getTravsportFromDb,
  saveTravsportToDb,
} from "@/lib/travsport-cache.server";
import {
  buildSnapshot,
  listGamesForDate,
  pickDefaultV85Game,
  todayIso,
} from "../../v86/src/pipeline";
import type { GameOption } from "../../v86/src/pipeline";
import type { FetchSnapshot } from "../../v86/src/types";

const travsportDb = {
  get: getTravsportFromDb,
  set: saveTravsportToDb,
};

export type { FetchSnapshot, GameOption };
export { pickDefaultV85Game, pickDefaultV85Game as pickDefaultV86Game };

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
      budgetKr?: number;
      targetMinPayoutKr?: number;
    }) =>
      z
        .object({
          date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
          gameId: z.string().min(1).optional(),
          budgetKr: z.number().min(25).max(50_000).optional(),
          targetMinPayoutKr: z.number().min(1_000).max(10_000_000).optional(),
        })
        .parse(d),
  )
  .handler(async ({ data }): Promise<FetchSnapshot> => {
    return buildSnapshot({
      date: data.date,
      gameId: data.gameId,
      budgetKr: data.budgetKr,
      targetMinPayoutKr: data.targetMinPayoutKr,
      includeAndelsspel: true,
      includeTravsport: true,
      travsportDbCache: travsportDb,
    });
  });
