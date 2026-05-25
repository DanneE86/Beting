import { describe, expect, it, vi } from "vitest";
import {
  pickDefaultPoolGame,
  sanitizeHistoricalGameForPrematch,
  type GameOption,
} from "../../../v86/src/pipeline";
import type { AtgGame } from "../../../v86/src/types";

describe("pickDefaultPoolGame", () => {
  it("föredrar närmaste kommande V86 före senare V85", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-25T07:00:00+02:00"));

    const games: GameOption[] = [
      {
        id: "V85_2026-05-30",
        type: "V85",
        typeLabel: "V85 (lördag)",
        status: "upcoming",
        startTime: "2026-05-30T16:20:00+02:00",
        isSaturdayRound: true,
      },
      {
        id: "V86_2026-05-27",
        type: "V86",
        typeLabel: "V86 (onsdag)",
        status: "upcoming",
        startTime: "2026-05-27T19:20:00+02:00",
        isWednesdayRound: true,
      },
    ];

    expect(pickDefaultPoolGame(games)?.id).toBe("V86_2026-05-27");
    vi.useRealTimers();
  });

  it("faller tillbaka till V85 när ingen V86 finns", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-25T07:00:00+02:00"));

    const games: GameOption[] = [
      {
        id: "V85_2026-05-30",
        type: "V85",
        typeLabel: "V85 (lördag)",
        status: "upcoming",
        startTime: "2026-05-30T16:20:00+02:00",
        isSaturdayRound: true,
      },
      {
        id: "dd_2026-05-25",
        type: "dd",
        typeLabel: "Dagens Dubbel",
        status: "upcoming",
        startTime: "2026-05-25T20:00:00+02:00",
      },
    ];

    expect(pickDefaultPoolGame(games)?.id).toBe("V85_2026-05-30");
    vi.useRealTimers();
  });

  it("strippar facit från historisk omgång före prematch-backtest", () => {
    const historical: AtgGame = {
      id: "V86_2026-05-21",
      type: "V86",
      status: "results",
      pools: {
        V86: {
          status: "results",
          result: { payouts: { "6": { payout: 1200 } } },
        },
      },
      races: [
        {
          id: "race-1",
          number: 1,
          status: "results",
          result: { victoryMargin: "huvud" },
          starts: [
            {
              id: "s1",
              number: 1,
              postPosition: 1,
              scratched: false,
              horse: { id: 1, name: "Test" },
              result: { finishOrder: 1, place: 1 },
              pools: {
                V86: {
                  status: "results",
                  result: { winners: [1], reserveOrder: [2] },
                },
              },
            },
          ],
          pools: {
            V86: {
              status: "results",
              result: { winners: [1], reserveOrder: [2] },
            },
          },
        },
      ],
    };

    const sanitized = sanitizeHistoricalGameForPrematch(historical);

    expect(sanitized.status).toBe("open");
    expect(sanitized.pools?.V86?.result).toBeUndefined();
    expect(sanitized.races[0]?.status).toBe("open");
    expect(sanitized.races[0]?.result).toBeUndefined();
    expect(sanitized.races[0]?.pools?.V86?.result).toBeUndefined();
    expect(sanitized.races[0]?.starts[0]?.result).toBeUndefined();
    expect(sanitized.races[0]?.starts[0]?.pools?.V86?.result).toBeUndefined();
  });
});
