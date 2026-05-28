import { describe, expect, it } from "vitest";
import {
  formatFootballBettingTip,
  formatFootballBttsLine,
  pickTopPct,
} from "@/lib/football-tip";

describe("football-tip", () => {
  it("formaterar tipp-rad", () => {
    expect(formatFootballBettingTip("H", 52)).toBe("Tippa 1 (52%)");
    expect(formatFootballBettingTip("D")).toBe("Tippa X");
  });

  it("formaterar BTTS", () => {
    expect(formatFootballBttsLine("ja")).toBe("Ja");
    expect(formatFootballBttsLine("nej")).toBe("Nej");
  });

  it("plockar rätt pct för utfall", () => {
    expect(pickTopPct("A", 40, 30, 35)).toBe(35);
  });
});
