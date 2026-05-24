import { describe, expect, it } from "vitest";
import {
  aggregateH2H,
  buildTemplateMatchAnalysis,
  scoringProfile,
  venueRecord,
} from "@/lib/match-analysis";
import { computeGoalStats, type ScheduleMatchRow } from "@/lib/form-stats";

const sample: ScheduleMatchRow[] = [
  {
    result: "W",
    score: "2-1",
    opponent: "A",
    homeAway: "home",
    usScore: 2,
    themScore: 1,
    date: "2025-01-01T00:00:00Z",
    opponentId: "opp-1",
  },
  {
    result: "D",
    score: "1-1",
    opponent: "B",
    homeAway: "away",
    usScore: 1,
    themScore: 1,
    date: "2025-01-08T00:00:00Z",
    opponentId: "opp-2",
  },
  {
    result: "L",
    score: "0-2",
    opponent: "C",
    homeAway: "home",
    usScore: 0,
    themScore: 2,
    date: "2025-01-15T00:00:00Z",
    opponentId: "opp-1",
  },
];

describe("match-analysis", () => {
  it("venueRecord räknar poäng och BTTS", () => {
    const v = venueRecord(sample, "home");
    expect(v.played).toBe(2);
    expect(v.points).toBe(3);
    expect(v.bttsPct).toBe(50);
  });

  it("scoringProfile klassar målprofil", () => {
    const stats = computeGoalStats(sample);
    expect(scoringProfile(stats)).toBeTruthy();
  });

  it("aggregateH2H summerar möten", () => {
    const h2h = aggregateH2H([
      { result: "W", score: "2-1", venue: "home" },
      { result: "D", score: "1-1", venue: "away" },
    ]);
    expect(h2h?.meetings).toBe(2);
    expect(h2h?.bttsPct).toBe(100);
  });

  it("buildTemplateMatchAnalysis fyller alla avsnitt", () => {
    const checklist = {
      homeLast6: [],
      awayLast6: [],
      homeAtHome: venueRecord(sample, "home"),
      awayOnRoad: venueRecord(sample, "away"),
      homeScoringProfile: "balanserad" as const,
      awayScoringProfile: "låst" as const,
      homeFavoriteRecord: null,
      awayAwayVsTop: null,
      h2hAggregate: null,
      eventMeta: null,
    };
    const sections = buildTemplateMatchAnalysis({
      homeName: "Hemma",
      awayName: "Borta",
      checklist,
      homeGoalStats: computeGoalStats(sample),
      awayGoalStats: computeGoalStats(sample),
    });
    expect(sections.grundlaggande.length).toBeGreaterThan(10);
    expect(sections.btts).toBeTruthy();
    expect(sections.oneXtwo).toBeTruthy();
    expect(sections.h2h).toBeTruthy();
    expect(sections.lagnyheter).toBeTruthy();
    expect(sections.ovrigt).toBeTruthy();
  });
});
