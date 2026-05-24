import { describe, expect, it } from "vitest";
import {
  ESPN_BASE,
  espnYmd,
  scoreboardUrl,
  standingsUrl,
  summaryUrl,
  teamRosterUrl,
  teamScheduleUrl,
} from "@/lib/espn.api";

describe("espn.api", () => {
  it("espnYmd formaterar UTC-datum", () => {
    expect(espnYmd(new Date("2025-03-08T15:30:00Z"))).toBe("20250308");
  });

  it("bygger scoreboard-URL", () => {
    expect(scoreboardUrl("eng.1", "20250101", "20250131")).toBe(
      `${ESPN_BASE}/site/v2/sports/soccer/eng.1/scoreboard?dates=20250101-20250131&limit=200`,
    );
  });

  it("bygger övriga ESPN-URL:er", () => {
    expect(summaryUrl("eng.1", "123")).toContain("/summary?event=123");
    expect(teamScheduleUrl("eng.1", "456")).toContain("/teams/456/schedule");
    expect(teamRosterUrl("eng.1", "456")).toContain("enable=roster");
    expect(standingsUrl("eng.1")).toContain("/standings");
  });
});
