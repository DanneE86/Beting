import { describe, expect, it } from "vitest";
import {
  buildFallbackTravPostmortem,
  buildSystemHitSummary,
  extractTravResult,
} from "@/lib/trav-learning.server";
import type { AtgGame, FetchSnapshot } from "../../../v86/src/types";

function buildGame(): AtgGame {
  return {
    id: "V86_2026-05-27_1",
    type: "V86",
    status: "results",
    pools: {
      V86: {
        result: {
          payouts: {
            "6": { payout: 2400, systems: 1200 },
            "7": { payout: 18200, systems: 132 },
            "8": { jackpot: true, systems: 0 },
          },
        },
      },
    },
    races: [
      {
        id: "race-1",
        number: 1,
        name: "Avd 1",
        starts: [
          {
            id: "start-1",
            number: 1,
            postPosition: 1,
            scratched: false,
            horse: { id: 1, name: "Favoriten" },
            result: { finishOrder: 1, finalOdds: 2.4 },
          },
        ],
        pools: {
          V86: {
            result: {
              winners: [1],
              reserveOrder: [2, 3],
            },
          },
        },
      },
      {
        id: "race-2",
        number: 2,
        name: "Avd 2",
        result: { victoryMargin: "huvud" },
        starts: [
          {
            id: "start-4",
            number: 4,
            postPosition: 4,
            scratched: false,
            horse: { id: 4, name: "Värdehästen" },
            result: { finishOrder: 1, finalOdds: 12.8 },
          },
          {
            id: "start-5",
            number: 5,
            postPosition: 5,
            scratched: false,
            horse: { id: 5, name: "Felhästen" },
            result: { finishOrder: 2, finalOdds: 4.1 },
          },
        ],
        pools: {
          V86: {
            result: {
              winners: [4],
              reserveOrder: [5, 6],
            },
          },
        },
      },
    ],
  };
}

function buildSnapshot(): FetchSnapshot {
  return {
    fetchedAt: "2026-05-27T10:00:00Z",
    game: {
      id: "V86_2026-05-27_1",
      type: "V86",
      status: "open",
      races: [],
      pools: {},
    },
    system: {
      rows: 2,
      costKr: 0.5,
      estimatedPayoutNote: "test",
      selections: [
        { leg: 1, picks: [1], type: "spik" },
        { leg: 2, picks: [5], type: "spik" },
      ],
    },
    legs: [
      {
        leg: 1,
        track: "Solvalla",
        horses: [
          {
            number: 1,
            name: "Favoriten",
            combinedScore: 0.7,
            horseScore: 0.7,
            driverScore: 0.6,
            formTrend: "stabil",
            betDistribution: 45,
            valueEdgePct: 2,
            horseChecklist: [],
            driverChecklist: [],
            highlights: [],
          },
        ],
      },
      {
        leg: 2,
        track: "Solvalla",
        horses: [
          {
            number: 4,
            name: "Värdehästen",
            combinedScore: 0.62,
            horseScore: 0.58,
            driverScore: 0.55,
            formTrend: "stigande",
            betDistribution: 9,
            valueEdgePct: 7.4,
            horseChecklist: [
              {
                id: "lane_start",
                label: "Spår/start",
                available: true,
                score: 0.82,
                note: "stark från liknande spår",
              },
            ],
            driverChecklist: [],
            highlights: ["Stark avslutning senast"],
          },
          {
            number: 5,
            name: "Felhästen",
            combinedScore: 0.6,
            horseScore: 0.6,
            driverScore: 0.6,
            formTrend: "stabil",
            betDistribution: 23,
            valueEdgePct: -2,
            horseChecklist: [],
            driverChecklist: [],
            highlights: [],
          },
        ],
      },
    ],
    meta: {
      analysisModel: "test",
    },
  } as unknown as FetchSnapshot;
}

function buildDdGame(): AtgGame {
  return {
    id: "dd_2025-11-27_18_8",
    type: "dd",
    status: "results",
    pools: {
      dd: {
        result: {
          winners: [{ combination: [6, 5], odds: 539 }],
        },
      },
    },
    races: [
      {
        id: "dd-race-1",
        number: 1,
        name: "DD-1",
        starts: [
          {
            id: "dd-start-1",
            number: 6,
            postPosition: 6,
            scratched: false,
            horse: { id: 6, name: "DD Spik" },
            result: { finishOrder: 1, finalOdds: 4.8 },
          },
        ],
        pools: {
          dd: {
            result: {
              winners: [6],
              reserveOrder: [1, 2],
            },
          },
        },
      },
      {
        id: "dd-race-2",
        number: 2,
        name: "DD-2",
        starts: [
          {
            id: "dd-start-2",
            number: 5,
            postPosition: 5,
            scratched: false,
            horse: { id: 5, name: "DD Gardering" },
            result: { finishOrder: 1, finalOdds: 6.1 },
          },
        ],
        pools: {
          dd: {
            result: {
              winners: [5],
              reserveOrder: [4, 7],
            },
          },
        },
      },
    ],
  };
}

function buildDdSnapshot(): FetchSnapshot {
  return {
    fetchedAt: "2025-11-27T10:00:00Z",
    game: {
      id: "dd_2025-11-27_18_8",
      type: "dd",
      status: "open",
      races: [],
      pools: {},
    },
    system: {
      rows: 4,
      costKr: 40,
      estimatedPayoutNote: "dd-test",
      selections: [
        { leg: 1, picks: [1, 6], type: "gardering" },
        { leg: 2, picks: [4, 5], type: "gardering" },
      ],
    },
    legs: [],
    meta: {
      analysisModel: "test",
    },
  } as unknown as FetchSnapshot;
}

describe("trav learning", () => {
  it("extraherar facit och räknar systemträff", () => {
    const resolved = extractTravResult(buildGame());
    const hitSummary = buildSystemHitSummary(buildSnapshot().system, resolved);

    expect(resolved.legs[0]?.winners).toEqual([1]);
    expect(resolved.legs[1]?.winners).toEqual([4]);
    expect(resolved.legs[1]?.finishers[0]?.number).toBe(4);
    expect(hitSummary.correctLegs).toBe(1);
    expect(hitSummary.totalLegs).toBe(2);
    expect(hitSummary.missLegs[0]?.leg).toBe(2);
  });

  it("bygger fallback-postmortem med hästdata och spårlärdomar", () => {
    const snapshot = buildSnapshot();
    const resolved = extractTravResult(buildGame());
    const hitSummary = buildSystemHitSummary(snapshot.system, resolved);
    const postmortem = buildFallbackTravPostmortem(snapshot, resolved, hitSummary);

    expect(postmortem.summary).toMatch(/1\/2 rätt/);
    expect(postmortem.why.join(" ")).toMatch(/grundsignaler|stigande|spår/i);
    expect(postmortem.lessons.join(" ")).toMatch(/spårhistorik|kombinerad score/i);
    expect(postmortem.signalsMissed?.join(" ")).toMatch(/spår|avslutning|stigande/i);
    expect(postmortem.alternativeActions?.[0]).toMatch(/Gardera avd 2/i);
  });

  it("räknar DD-utdelning från vinnande kombinationsodds", () => {
    const resolved = extractTravResult(buildDdGame());
    const hitSummary = buildSystemHitSummary(buildDdSnapshot().system, resolved);

    expect(hitSummary.correctLegs).toBe(2);
    expect(hitSummary.fullHit).toBe(true);
    expect(hitSummary.winningRowCount).toBe(1);
    expect(hitSummary.payoutAmountKr).toBe(5_390);
    expect(hitSummary.payoutPerWinningRowKr).toBe(5_390);
  });
});
