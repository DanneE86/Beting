import { describe, expect, it } from "vitest";
import {
  brierScore,
  isExactScore,
  outcomeFromScore,
  outcomeToTip,
  tipToOutcome,
} from "@/lib/match-outcome";

describe("match-outcome", () => {
  it("outcomeToTip mappar H/D/A → 1/X/2", () => {
    expect(outcomeToTip("H")).toBe("1");
    expect(outcomeToTip("D")).toBe("X");
    expect(outcomeToTip("A")).toBe("2");
    expect(outcomeToTip(null)).toBe("X");
  });

  it("tipToOutcome är invers till outcomeToTip", () => {
    expect(tipToOutcome("1")).toBe("H");
    expect(tipToOutcome("X")).toBe("D");
    expect(tipToOutcome("2")).toBe("A");
    expect(tipToOutcome("?")).toBeNull();
  });

  it("outcomeFromScore från mål", () => {
    expect(outcomeFromScore(2, 1)).toBe("1");
    expect(outcomeFromScore(0, 3)).toBe("2");
    expect(outcomeFromScore(1, 1)).toBe("X");
    expect(outcomeFromScore(null, 1)).toBeNull();
  });

  it("isExactScore jämför predikterat resultat", () => {
    expect(isExactScore("2-1", 2, 1)).toBe(true);
    expect(isExactScore("2 - 1", 2, 1)).toBe(true);
    expect(isExactScore("1-2", 2, 1)).toBe(false);
    expect(isExactScore(null, 2, 1)).toBe(false);
  });

  it("brierScore är lägre vid träff", () => {
    const hit = brierScore(60, 25, 15, "H");
    const miss = brierScore(10, 25, 65, "H");
    expect(hit).toBeLessThan(miss);
  });
});
