import { describe, expect, it } from "vitest";
import {
  DEFAULT_CFG,
  isObjectiveSecured,
  maxCatchablePts,
  motivationWeight,
  stakeForTeam,
  stakeLabelSv,
} from "@/lib/season-stakes";

describe("season-stakes", () => {
  it("maxCatchablePts = 3 poäng per omgång", () => {
    expect(maxCatchablePts(5)).toBe(15);
    expect(maxCatchablePts(0)).toBe(0);
  });

  it("isObjectiveSecured när försprånget är för stort", () => {
    expect(isObjectiveSecured(80, 60, 5)).toBe(true);
    expect(isObjectiveSecured(70, 60, 5)).toBe(false);
  });

  it("motivationWeight ger högst vid guld/nedflyttning", () => {
    expect(motivationWeight("guld")).toBeGreaterThan(motivationWeight("europaplats"));
    expect(motivationWeight("cl-säkrad")).toBe(0);
  });

  it("stakeLabelSv returnerar svenska etiketter", () => {
    expect(stakeLabelSv("guld")).toBe("guldstrid");
    expect(stakeLabelSv("nedflyttning")).toBe("nedflyttningsstrid");
  });

  it("stakeForTeam identifierar ledare som guldstrid", () => {
    const sorted = [
      { rank: 1, pts: 80 },
      { rank: 2, pts: 70 },
      { rank: 3, pts: 65 },
      { rank: 4, pts: 60 },
      { rank: 5, pts: 55 },
      { rank: 6, pts: 50 },
    ];
    expect(stakeForTeam(sorted[0], sorted, DEFAULT_CFG, 5)).toBe("guld");
  });
});
