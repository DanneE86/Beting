import { describe, expect, it } from "vitest";

import {
  extractRefereeMatchSample,
  summarizeRefereeSamples,
} from "@/lib/referee-profile";

describe("referee-profile", () => {
  it("summerar domarprofil fran matchsampel", () => {
    const profile = summarizeRefereeSamples("Test Ref", [
      { yellowCards: 7, redCards: 1, fouls: 28, penalties: 1 },
      { yellowCards: 6, redCards: 0, fouls: 24, penalties: 0 },
      { yellowCards: 5, redCards: 0, fouls: 25, penalties: 1 },
    ]);
    expect(profile?.style).toBe("kortbenagen");
    expect(profile?.avgYellowCards).toBe(6);
    expect(profile?.sampleSize).toBe(3);
  });

  it("laser ut kort och fouls fran ESPN-summary", () => {
    const sample = extractRefereeMatchSample({
      boxscore: {
        teams: [
          {
            statistics: [
              { name: "yellowCards", displayValue: "3" },
              { name: "redCards", displayValue: "1" },
              { name: "foulsCommitted", displayValue: "11" },
            ],
          },
          {
            statistics: [
              { name: "yellowCards", displayValue: "2" },
              { name: "redCards", displayValue: "0" },
              { name: "foulsCommitted", displayValue: "14" },
            ],
          },
        ],
      },
      plays: [{ text: "Penalty scored by Home" }],
    });

    expect(sample).toEqual({
      yellowCards: 5,
      redCards: 1,
      fouls: 25,
      penalties: 1,
    });
  });
});
