import { describe, expect, it } from "vitest";
import {
  CALENDAR_YEAR_LEAGUES,
  seasonDateRange,
  seasonLabelForDate,
} from "@/lib/season-label";

describe("season-label", () => {
  it("kalenderår-liga ger enkelt år", () => {
    const d = new Date("2025-05-15T12:00:00Z");
    expect(seasonLabelForDate("swe.1", d)).toBe("2025");
    expect(CALENDAR_YEAR_LEAGUES.has("swe.1")).toBe(true);
  });

  it("europeisk säsong aug–jun", () => {
    expect(seasonLabelForDate("eng.1", new Date("2025-08-01T00:00:00Z"))).toBe(
      "2025-2026",
    );
    expect(seasonLabelForDate("eng.1", new Date("2025-03-01T00:00:00Z"))).toBe(
      "2024-2025",
    );
  });

  it("seasonDateRange för kalenderår", () => {
    expect(seasonDateRange("swe.1", "2024", 2024)).toEqual({
      fromYmd: "20240101",
      toYmd: "20241231",
    });
  });

  it("seasonDateRange för europasäsong", () => {
    expect(seasonDateRange("eng.1", "2024-2025", 2024)).toEqual({
      fromYmd: "20240701",
      toYmd: "20250630",
    });
  });
});
