import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AtgGame } from "../../../v86/src/types";
import type { TravsportHorseProfile } from "../../../v86/src/travsport/types";
import { fetchTravsportForGame, type TravsportCacheBackend } from "../../../v86/src/travsport/fetch-game";
import { fetchHorseResultsRaw } from "../../../v86/src/travsport/api";

vi.mock("../../../v86/src/travsport/api", () => ({
  fetchHorseResultsRaw: vi.fn(),
}));

function buildGame(): AtgGame {
  return {
    id: "V86_2026-05-27_1",
    type: "V86",
    status: "open",
    races: [
      {
        id: "race-1",
        number: 1,
        track: { name: "Solvalla" },
        starts: [
          {
            id: "start-1",
            number: 1,
            scratched: false,
            horse: { id: 101, name: "Alpha" },
            driver: { id: 11, firstName: "A", lastName: "Driver" },
          },
          {
            id: "start-2",
            number: 2,
            scratched: false,
            horse: { id: 202, name: "Beta" },
            driver: { id: 22, firstName: "B", lastName: "Driver" },
          },
        ],
      },
    ],
    pools: {},
  } as unknown as AtgGame;
}

function profile(horseId: number, fetchedAt: string): TravsportHorseProfile {
  return {
    horseId,
    fetchedAt,
    starts: [],
    recentStarts: [],
    formTrend: "okänd",
    daysSinceLastStart: null,
    trackWins: 0,
    trackStarts: 0,
    driverPairStarts: 0,
    driverPairWins: 0,
    tempoTripProfile: {
      sampleSize: 0,
      earlySpeedScore: 0.5,
      closingSpeedScore: 0.5,
      versatilityScore: 0.5,
      profileScore: 0.5,
      style: "okänd",
      note: "Ingen tydlig tempo/trip-historik ännu",
    },
    gallopProfile: {
      sampleSize: 0,
      gallopStarts: 0,
      gallopRate: 0,
      recentGallopRate: 0,
      stabilityScore: 0.5,
      riskLevel: "medel",
      note: "Ingen galopphistorik ännu",
    },
  };
}

describe("fetchTravsportForGame cache", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("använder batch-cache och undviker API när historisk cache får vara stale", async () => {
    const dbCache: TravsportCacheBackend = {
      get: vi.fn(),
      getMany: vi.fn(async () => ({
        101: profile(101, "2026-05-20T08:00:00Z"),
        202: profile(202, "2026-05-20T08:00:00Z"),
      })),
      set: vi.fn(),
    };

    const result = await fetchTravsportForGame(buildGame(), {
      dbCache,
      useCache: true,
      allowStaleCache: true,
    });

    expect(dbCache.getMany).toHaveBeenCalledOnce();
    expect(fetchHorseResultsRaw).not.toHaveBeenCalled();
    expect(Object.keys(result)).toEqual(["101", "202"]);
  });

  it("hämtar bara om stale profiler när live-körning kräver färsk cache", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-25T12:00:00Z"));

    const dbCache: TravsportCacheBackend = {
      get: vi.fn(),
      getMany: vi.fn(async () => ({
        101: profile(101, "2026-05-25T10:00:00Z"),
        202: profile(202, "2026-05-24T00:00:00Z"),
      })),
      set: vi.fn(),
    };

    vi.mocked(fetchHorseResultsRaw).mockResolvedValue([]);

    const result = await fetchTravsportForGame(buildGame(), {
      dbCache,
      useCache: true,
    });

    expect(dbCache.getMany).toHaveBeenCalledOnce();
    expect(fetchHorseResultsRaw).toHaveBeenCalledTimes(1);
    expect(fetchHorseResultsRaw).toHaveBeenCalledWith(202);
    expect(result[101]?.fetchedAt).toBe("2026-05-25T10:00:00Z");
    expect(dbCache.set).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
  });
});
