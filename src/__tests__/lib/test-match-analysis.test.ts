import { describe, expect, it } from "vitest";
import {
  aggregateH2H,
  buildBttsAnalysisSection,
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

  it("buildBttsAnalysisSection ger fallback från tabell när form saknas", () => {
    const checklist = {
      homeLast6: [],
      awayLast6: [],
      homeAtHome: venueRecord([], "home"),
      awayOnRoad: venueRecord([], "away"),
      homeScoringProfile: "okänd" as const,
      awayScoringProfile: "okänd" as const,
      homeFavoriteRecord: null,
      awayAwayVsTop: null,
      h2hAggregate: null,
      eventMeta: null,
    };
    const text = buildBttsAnalysisSection({
      homeName: "Hemma",
      awayName: "Borta",
      checklist,
      homeGoalStats: null,
      awayGoalStats: null,
      homeStanding: { played: 10, gf: 18, ga: 12 },
      awayStanding: { played: 10, gf: 16, ga: 14 },
      bttsCall: "ja",
      bttsReason: "Ja ~58% (Poisson + form).",
    });
    expect(text.length).toBeGreaterThan(20);
    expect(text).toMatch(/Säsongssnitt|Modell|BTTS ja/i);
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
      eventMeta: {
        weather: "klart",
        referee: "Test Ref",
        venue: "Arena",
        matchNote: "derby",
        refereeProfile: {
          name: "Test Ref",
          sampleSize: 8,
          avgYellowCards: 5.6,
          avgRedCards: 0.2,
          avgFouls: 24.1,
          penaltiesPerMatch: 0.4,
          style: "kortbenagen" as const,
          note: "Test Ref: kortbenagen, snitt 5.6 gula / 0.2 roda / 24.1 fouls over 8 matcher.",
        },
      },
    };
    const sections = buildTemplateMatchAnalysis({
      homeName: "Hemma",
      awayName: "Borta",
      checklist,
      homeGoalStats: computeGoalStats(sample),
      awayGoalStats: computeGoalStats(sample),
    });
    expect(sections.grundlaggande.length).toBeGreaterThan(10);
    expect(sections.btts.length).toBeGreaterThan(10);
    expect(sections.oneXtwo).toBeTruthy();
    expect(sections.h2h).toBeTruthy();
    expect(sections.lagnyheter).toBeTruthy();
    expect(sections.ovrigt).toBeTruthy();
    expect(sections.ovrigt).toMatch(/Domarprofil/i);
  });
});
