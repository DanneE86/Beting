import { describe, expect, it } from "vitest";
import { applyRule3Overlay } from "../../../v86/src/expert-data";
import { applyRule4Overlay, buildRule4MissingDataNotes } from "../../../v86/src/rule4-data";
import { defaultRuleCoverage, normalizeTravRuleId } from "../../../v86/src/rules";
import type { ExpertConsensusHorse, LegAnalysis, ScoredHorse, SnapshotRaceData } from "../../../v86/src/types";

function horse(number: number, name: string, combinedScore: number): ScoredHorse {
  return {
    number,
    name,
    driver: "Kusk",
    betDistribution: 0,
    winOdds: null,
    winPct: 0,
    earningsPerStart: 0,
    formScore: combinedScore * 100,
    valueScore: combinedScore,
    horseScore: combinedScore + 0.02,
    driverScore: combinedScore - 0.01,
    combinedScore,
    estimatedWinPct: Math.round(combinedScore * 1000) / 10,
    formTrend: "stigande",
    highlights: [],
    horseChecklist: [],
    driverChecklist: [],
    isSkrellCandidate: false,
  };
}

describe("trav rules", () => {
  it("normaliserar okända regel-id till Regel 1", () => {
    expect(normalizeTravRuleId()).toBe("rule1");
    expect(normalizeTravRuleId("rule2")).toBe("rule2");
    expect(normalizeTravRuleId("rule4")).toBe("rule4");
    expect(normalizeTravRuleId("något-annat")).toBe("rule1");
  });

  it("visar att Regel 3 saknar expertfält tills källor är kopplade", () => {
    const coverage = defaultRuleCoverage("rule3");
    expect(coverage.find((group) => group.id === "horseCore")?.status).toBe("available");
    expect(coverage.find((group) => group.id === "expertConsensus")?.status).toBe("missing");
    expect(coverage.find((group) => group.id === "ratings")?.status).toBe("missing");
  });

  it("markerar Regel 4 som djup loppbild med blandad datatäckning", () => {
    const coverage = defaultRuleCoverage("rule4");
    expect(coverage.find((group) => group.id === "horseCore")?.status).toBe("available");
    expect(coverage.find((group) => group.id === "technicalCore")?.status).toBe("partial");
    expect(coverage.find((group) => group.id === "expertConsensus")?.status).toBe("missing");
  });

  it("låter expertkonsensus höja en häst i Regel 3", () => {
    const legs: LegAnalysis[] = [
      {
        leg: 1,
        raceId: "race-1",
        track: "Solvalla",
        raceName: "Avd 1",
        horses: [horse(1, "Ettan", 0.66), horse(2, "Tvåan", 0.64), horse(3, "Trean", 0.6)],
        favorite: horse(1, "Ettan", 0.66),
        skrellSpike: null,
        recommendation: "gardering",
        bankabilityScore: 0.55,
        opennessScore: 0.45,
        tipNote: "test",
      },
    ];
    const consensus: ExpertConsensusHorse[] = [
      {
        leg: 1,
        horseNumber: 2,
        horseName: "Tvåan",
        sourceCount: 2,
        consensusPoints: 4.5,
        sourceNames: ["ATG", "Öppen källa"],
      },
    ];

    const overlay = applyRule3Overlay(legs, consensus);

    expect(overlay[0]?.horses[0]?.number).toBe(2);
    expect(overlay[0]?.horses[0]?.highlights.join(" ")).toMatch(/Expertstöd/i);
  });

  it("viktar upp travsäker häst i Regel 4-overlay", () => {
    const legs: LegAnalysis[] = [
      {
        leg: 1,
        raceId: "race-1",
        track: "Solvalla",
        raceName: "Avd 1",
        horses: [
          { ...horse(1, "Riskhästen", 0.66), gallopRiskLevel: "hög", gallopRiskScore: 0.3, tempoTripScore: 0.62 },
          { ...horse(2, "Trygg", 0.64), gallopRiskLevel: "låg", gallopRiskScore: 0.86, tempoTripScore: 0.74 },
        ],
        favorite: horse(1, "Riskhästen", 0.66),
        skrellSpike: null,
        recommendation: "gardering",
      },
    ];
    const raceData: SnapshotRaceData[] = [
      {
        leg: 1,
        raceId: "race-1",
        raceNumber: 1,
        starts: [
          {
            startId: "s1",
            number: 1,
            postPosition: 1,
            scratched: false,
            travsportProfile: { starts: Array.from({ length: 6 }, () => ({})), recentStarts: [] } as any,
          },
          {
            startId: "s2",
            number: 2,
            postPosition: 2,
            scratched: false,
            travsportProfile: { starts: Array.from({ length: 12 }, () => ({})), recentStarts: [] } as any,
          },
        ],
      } as SnapshotRaceData,
    ];

    const overlay = applyRule4Overlay(legs, raceData);
    expect(overlay[0]?.horses[0]?.number).toBe(2);
    expect(overlay[0]?.tipNote).toMatch(/djup loppbild/i);
  });

  it("bygger databristrapport för Regel 4", () => {
    const raceData: SnapshotRaceData[] = [
      {
        leg: 1,
        raceId: "race-1",
        raceNumber: 1,
        starts: [
          {
            startId: "s1",
            number: 1,
            postPosition: 1,
            scratched: false,
            travsportProfile: {
              tempoTripProfile: { sampleSize: 8 },
              gallopProfile: { sampleSize: 8 },
              recentStarts: [{}, {}],
              starts: [{ kmTimeSeconds: 74.2, withdrawn: false }],
            } as any,
          },
          {
            startId: "s2",
            number: 2,
            postPosition: 2,
            scratched: false,
            travsportProfile: null,
          },
        ],
      } as SnapshotRaceData,
    ];

    const notes = buildRule4MissingDataNotes(raceData);
    expect(notes[0]).toMatch(/Regel 4 datatäckning/i);
    expect(notes.join(" ")).toMatch(/saknar Travsporthistorik/i);
  });
});
