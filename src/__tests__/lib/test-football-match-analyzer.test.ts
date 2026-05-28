import { describe, expect, it } from "vitest";
import { analyzeMatchOutcome } from "@/lib/football-match-analyzer";

const history = [
  {
    league_id: "eng.1",
    home_id: "h1",
    away_id: "a1",
    home_score: 2,
    away_score: 0,
    outcome: "1",
    btts: false,
    event_date: "2025-10-01T15:00:00Z",
  },
  {
    league_id: "eng.1",
    home_id: "h1",
    away_id: "a2",
    home_score: 1,
    away_score: 1,
    outcome: "X",
    btts: true,
    event_date: "2025-10-08T15:00:00Z",
  },
  {
    league_id: "eng.1",
    home_id: "h2",
    away_id: "a1",
    home_score: 0,
    away_score: 2,
    outcome: "2",
    btts: false,
    event_date: "2025-10-15T15:00:00Z",
  },
];

describe("analyzeMatchOutcome", () => {
  it("ger summary, tags och baseline jämfört med facit", () => {
    const match = {
      league_id: "eng.1",
      home_id: "h1",
      away_id: "a1",
      home_name: "Arsenal",
      away_name: "Chelsea",
      home_score: 2,
      away_score: 1,
      outcome: "1",
      btts: true,
      event_date: "2025-11-01T15:00:00Z",
    };
    const a = analyzeMatchOutcome(match, history);
    expect(a.summary).toContain("Arsenal");
    expect(a.why.length).toBeGreaterThan(0);
    expect(a.tags.length).toBeGreaterThan(0);
    expect(["H", "D", "A"]).toContain(a.actualOutcome);
    expect(a.baselineProbs.home).toBeGreaterThan(0);
  });
});
