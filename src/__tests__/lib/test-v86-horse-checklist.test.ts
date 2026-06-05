import { describe, expect, it } from "vitest";
import { scoreHorseChecklist } from "../../../v86/src/scoring/horse-checklist";
import type { AtgRace, AtgStart } from "../../../v86/src/types";
import type { TravsportHorseProfile } from "../../../v86/src/travsport/types";

function buildStart(postPosition: number): AtgStart {
  return {
    id: `start-${postPosition}`,
    number: postPosition,
    postPosition,
    scratched: false,
    horse: {
      id: postPosition,
      name: `Horse ${postPosition}`,
      age: 5,
      sex: "gelding",
      record: {
        startMethod: "auto",
        distance: "medium",
        time: { minutes: 1, seconds: 13, tenths: 0 },
      },
      trainer: {
        shortName: "Trainer",
        statistics: { years: { "2026": { winPercentage: 1500 } } },
      },
      statistics: {
        life: { earningsPerStart: 1200000, records: [] },
        years: { "2026": { starts: 5, placement: { "1": 1, "2": 1, "3": 1 }, records: [] } },
      },
    },
  };
}

function buildRace(): AtgRace {
  return {
    id: "race-1",
    number: 1,
    name: "Testlopp",
    distance: 2140,
    startMethod: "auto",
    track: { name: "Åby" },
    starts: [buildStart(10), buildStart(2)],
  };
}

function buildProfile(startRows: TravsportHorseProfile["starts"]): TravsportHorseProfile {
  return {
    horseId: 10,
    fetchedAt: new Date().toISOString(),
    starts: startRows,
    recentStarts: startRows.slice(0, 6),
    formTrend: "stigande",
    daysSinceLastStart: 18,
    trackWins: 1,
    trackStarts: 4,
    driverPairStarts: 3,
    driverPairWins: 1,
    tempoTripProfile: {
      sampleSize: startRows.length,
      earlySpeedScore: 0.72,
      closingSpeedScore: 0.54,
      versatilityScore: 0.58,
      profileScore: 0.66,
      style: "front",
      note: "Tidig ledarprofil",
    },
    gallopProfile: {
      sampleSize: startRows.length,
      gallopStarts: 0,
      gallopRate: 0,
      recentGallopRate: 0,
      stabilityScore: 0.92,
      riskLevel: "låg",
      note: "0/3 starter med galopp/disk",
    },
    surfaceHistory: [],
    trainerTrackStats: [],
  };
}

describe("scoreHorseChecklist spårhistorik", () => {
  it("höjer lane_start när hästen historiskt går bra från samma spår", () => {
    const race = buildRace();
    const start = buildStart(10);
    const strongProfile = buildProfile([
      {
        date: "2026-05-01",
        displayDate: "2026-05-01",
        trackCode: "Å",
        raceNumber: 1,
        placement: 1,
        placementDisplay: "1",
        resultCode: "1",
        kmTime: "13,2a",
        kmTimeSeconds: 73.2,
        startPosition: 10,
        distance: 2140,
        startMethod: "auto",
        trackCondition: "",
        driverId: 1,
        driverName: "Driver",
        trainerId: 1,
        trainerName: "Trainer",
        odds: "",
        shoeCode: "",
        withdrawn: false,
        galloped: false,
        disqualified: false,
      },
      {
        date: "2026-04-10",
        displayDate: "2026-04-10",
        trackCode: "Å",
        raceNumber: 2,
        placement: 3,
        placementDisplay: "3",
        resultCode: "3",
        kmTime: "13,7a",
        kmTimeSeconds: 73.7,
        startPosition: 10,
        distance: 2140,
        startMethod: "auto",
        trackCondition: "",
        driverId: 1,
        driverName: "Driver",
        trainerId: 1,
        trainerName: "Trainer",
        odds: "",
        shoeCode: "",
        withdrawn: false,
        galloped: false,
        disqualified: false,
      },
      {
        date: "2026-03-10",
        displayDate: "2026-03-10",
        trackCode: "Å",
        raceNumber: 3,
        placement: 2,
        placementDisplay: "2",
        resultCode: "2",
        kmTime: "13,5a",
        kmTimeSeconds: 73.5,
        startPosition: 9,
        distance: 2140,
        startMethod: "auto",
        trackCondition: "",
        driverId: 1,
        driverName: "Driver",
        trainerId: 1,
        trainerName: "Trainer",
        odds: "",
        shoeCode: "",
        withdrawn: false,
        galloped: false,
        disqualified: false,
      },
    ]);

    const result = scoreHorseChecklist(start, race, race.starts, strongProfile);
    const laneItem = result.items.find((item) => item.id === "lane_start");
    expect(laneItem?.score).toBeGreaterThan(0.7);
    expect(laneItem?.note).toMatch(/samma spår|liknande spår/i);
  });

  it("sänker lane_start när historiken från samma spår är svag", () => {
    const race = buildRace();
    const start = buildStart(10);
    const weakProfile = buildProfile([
      {
        date: "2026-05-01",
        displayDate: "2026-05-01",
        trackCode: "Å",
        raceNumber: 1,
        placement: 8,
        placementDisplay: "8",
        resultCode: "8",
        kmTime: "15,2a",
        kmTimeSeconds: 75.2,
        startPosition: 10,
        distance: 2140,
        startMethod: "auto",
        trackCondition: "",
        driverId: 1,
        driverName: "Driver",
        trainerId: 1,
        trainerName: "Trainer",
        odds: "",
        shoeCode: "",
        withdrawn: false,
        galloped: false,
        disqualified: false,
      },
      {
        date: "2026-04-10",
        displayDate: "2026-04-10",
        trackCode: "Å",
        raceNumber: 2,
        placement: 7,
        placementDisplay: "7",
        resultCode: "7",
        kmTime: "15,0a",
        kmTimeSeconds: 75.0,
        startPosition: 10,
        distance: 2140,
        startMethod: "auto",
        trackCondition: "",
        driverId: 1,
        driverName: "Driver",
        trainerId: 1,
        trainerName: "Trainer",
        odds: "",
        shoeCode: "",
        withdrawn: false,
        galloped: false,
        disqualified: false,
      },
      {
        date: "2026-03-10",
        displayDate: "2026-03-10",
        trackCode: "Å",
        raceNumber: 3,
        placement: 6,
        placementDisplay: "6",
        resultCode: "6",
        kmTime: "14,9a",
        kmTimeSeconds: 74.9,
        startPosition: 9,
        distance: 2140,
        startMethod: "auto",
        trackCondition: "",
        driverId: 1,
        driverName: "Driver",
        trainerId: 1,
        trainerName: "Trainer",
        odds: "",
        shoeCode: "",
        withdrawn: false,
        galloped: false,
        disqualified: false,
      },
    ]);

    const result = scoreHorseChecklist(start, race, race.starts, weakProfile);
    const laneItem = result.items.find((item) => item.id === "lane_start");
    expect(laneItem?.score).toBeLessThan(0.6);
    expect(result.highlights.some((text) => /Spårhistorik svag/i.test(text))).toBe(true);
  });

  it("lägger in tempo/trip och galopprisk i checklistan", () => {
    const race = buildRace();
    const start = buildStart(2);
    const profile = buildProfile([
      {
        date: "2026-05-01",
        displayDate: "2026-05-01",
        trackCode: "Å",
        raceNumber: 1,
        placement: 1,
        placementDisplay: "1",
        resultCode: "1",
        kmTime: "13,0a",
        kmTimeSeconds: 73,
        startPosition: 2,
        distance: 2140,
        startMethod: "auto",
        trackCondition: "",
        driverId: 1,
        driverName: "Driver",
        trainerId: 1,
        trainerName: "Trainer",
        odds: "",
        shoeCode: "",
        withdrawn: false,
        galloped: false,
        disqualified: false,
      },
    ]);

    const result = scoreHorseChecklist(start, race, race.starts, profile);
    const tempoItem = result.items.find((item) => item.id === "tempo_trip");
    const gallopItem = result.items.find((item) => item.id === "gallop_risk");

    expect(tempoItem?.score).toBeGreaterThan(0.6);
    expect(tempoItem?.note).toMatch(/ledarprofil/i);
    expect(gallopItem?.score).toBeGreaterThan(0.8);
    expect(result.highlights.join(" ")).toMatch(/Travsäker|ledarprofil/i);
  });
});
