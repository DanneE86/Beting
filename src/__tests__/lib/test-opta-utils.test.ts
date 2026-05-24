import { describe, expect, it } from "vitest";
import { findOptaMatch, normTeam } from "@/lib/opta.utils";
import type { OptaMatch } from "@/lib/opta.scraper";

const baseMatch = (over: Partial<OptaMatch> = {}): OptaMatch => ({
  id: "1",
  status: "scheduled",
  date: 0,
  leagueId: "pl",
  leagueName: "PL",
  leagueSeo: "pl",
  homeId: "h1",
  homeName: "Arsenal FC",
  awayId: "a1",
  awayName: "Chelsea",
  link: "",
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
});
