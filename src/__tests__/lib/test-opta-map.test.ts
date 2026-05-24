import { describe, expect, it } from "vitest";
import { mapOptaMatch } from "@/lib/opta.scraper";

describe("mapOptaMatch", () => {
  it("mappar fixture utan resultat men med land", () => {
    const raw = {
      id: "abc",
      status: "fixture",
      date: 1779649200,
      coverage: 13,
      period: 16,
      comp: {
        id: "liga1",
        name: "Primera División",
        nameSeo: "primera",
        link: "/en_GB/soccer/la-liga/results",
        country: {
          id: "es",
          name: "spain",
          fullName: "Spain",
          flag: "/images/flags/es.svg",
        },
      },
      link: "/en_GB/soccer/match/foo/abc",
      home: { id: "h1", name: "Villarreal" },
      away: { id: "a1", name: "Atlético" },
    };
    const m = mapOptaMatch(raw);
    expect(m.countryFullName).toBe("Spain");
    expect(m.leagueLink).toContain("la-liga/results");
    expect(m.scoreFt).toBeNull();
    expect(m.scoreTotal).toBeNull();
  });

  it("mappar spelad match med HT/FT och målräkning", () => {
    const raw = {
      id: "55x",
      status: "played",
      comp: { name: "Premier League", country: { fullName: "England" } },
      home: { name: "Brighton" },
      away: { name: "Man Utd" },
      score: {
        ht: { home: 0, away: 2 },
        ft: { home: 0, away: 3 },
        total: { home: 0, away: 3 },
      },
      events: [
        { entity_type: "goal", type: "G" },
        { entity_type: "goal", type: "G" },
        { entity_type: "card", type: "YC" },
        { entity_type: "goal", type: "G" },
      ],
    };
    const m = mapOptaMatch(raw);
    expect(m.scoreFt).toEqual({ home: 0, away: 3 });
    expect(m.scoreHt).toEqual({ home: 0, away: 2 });
    expect(m.scoreTotal).toEqual({ home: 0, away: 3 });
    expect(m.goalCount).toBe(3);
  });
});
