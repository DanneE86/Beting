import { describe, expect, it } from "vitest";
import { findOptaMatch, formatOptaMatchSummary, normTeam } from "@/lib/opta.utils";
import type { OptaMatch } from "@/lib/opta.scraper";

const baseMatch = (over: Partial<OptaMatch> = {}): OptaMatch => ({
  id: "1",
  status: "scheduled",
  date: 0,
  leagueId: "pl",
  leagueName: "PL",
  leagueSeo: "pl",
  leagueLink: "",
  countryId: "",
  countryName: "",
  countryFullName: "",
  countryFlag: "",
  homeId: "h1",
  homeName: "Arsenal FC",
  awayId: "a1",
  awayName: "Chelsea",
  link: "",
  coverage: null,
  period: null,
  updated: null,
  scoreHt: null,
  scoreFt: null,
  scoreTotal: null,
  goalCount: null,
  ...over,
});

describe("opta.utils", () => {
  it("normTeam normaliserar accenter och skiljetecken", () => {
    expect(normTeam("São Paulo")).toBe("saopaulo");
    expect(normTeam("Arsenal FC")).toBe("arsenalfc");
  });

  it("findOptaMatch matchar lag med delsträng", () => {
    const matches = [baseMatch()];
    expect(findOptaMatch(matches, "Arsenal", "Chelsea")?.id).toBe("1");
    expect(findOptaMatch(matches, "Liverpool", "City")).toBeUndefined();
  });

  it("formatOptaMatchSummary inkluderar land, liga och resultat", () => {
    const m = baseMatch({
      countryFullName: "England",
      leagueName: "Premier League",
      status: "played",
      scoreFt: { home: 0, away: 3 },
      scoreHt: { home: 0, away: 2 },
    });
    expect(formatOptaMatchSummary(m)).toBe(
      "Opta: England · Premier League · played · 0-3 (HT 0-2)",
    );
  });
});
